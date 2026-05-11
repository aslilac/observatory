// N-API exports for the scanner.
//
// Surface mirrors the JS VirtualFileSystem class: a `Scan` handle that
// can be started, polled for progress mid-flight, and aborted. The Rust
// scan runs on libuv's threadpool (via napi-rs AsyncTask) so the JS main
// thread stays free to handle IPC during long scans.
//
// JS objects are built directly via the Env API rather than serializing
// through JSON — skipping `JSON.parse` is the whole point of the napi
// binding. The discriminated VfsNode union (Directory | File) becomes
// JS objects with a `type` discriminant, matching `Ob.VfsNode` in
// Observatory.d.ts.

use crate::{
	CountsSnapshot, PerfNode, ScanError, ScanErrorKind, ScanResult, ScanState,
	VfsNode, root_dev_id, run_scan,
};
use napi::bindgen_prelude::*;
use napi::{Env, JsObject, Task};
use napi_derive::napi;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;

#[napi(object)]
pub struct ScanOptions {
	pub perf: Option<bool>,
}

#[napi]
pub struct Scan {
	path: PathBuf,
	state: Arc<ScanState>,
}

#[napi]
impl Scan {
	#[napi(constructor)]
	pub fn new(path: String, options: Option<ScanOptions>) -> Result<Self> {
		let perf = options.and_then(|o| o.perf).unwrap_or(false);
		// Resolve root dev up-front the same way `scan()` does. Failing here
		// gives the caller a clean rejection before any background work
		// starts (e.g. user passed a non-existent path).
		let root_meta = std::fs::metadata(&path)
			.map_err(|e| Error::from_reason(format!("stat failed: {e}")))?;
		let state = ScanState::new(perf, root_dev_id(&root_meta));
		Ok(Self {
			path: PathBuf::from(path),
			state: Arc::new(state),
		})
	}

	/// Kick off the scan on libuv's threadpool. Returns a Promise resolving
	/// to the final ScanResult. Safe to call only once per Scan instance —
	/// subsequent calls will start a second scan that shares the same state
	/// and produce confusing results.
	#[napi]
	pub fn start(&self) -> AsyncTask<ScanTask> {
		AsyncTask::new(ScanTask {
			path: self.path.clone(),
			state: Arc::clone(&self.state),
		})
	}

	/// Snapshot of in-progress state. Cheap; safe to poll on a tight
	/// interval. Counts use atomics (lockless), currentPath/errors take
	/// short Mutex acquisitions that contend with the scan only at
	/// directory boundaries.
	#[napi]
	pub fn progress(&self, env: Env) -> Result<JsObject> {
		let mut obj = env.create_object()?;
		obj.set_named_property(
			"counts",
			counts_to_js(&env, &self.state.counts.snapshot())?,
		)?;
		let cp = self.state.current_path.lock().ok().and_then(|g| g.clone());
		match cp {
			Some(p) => obj.set_named_property("currentPath", env.create_string(&p)?)?,
			None => obj.set_named_property("currentPath", env.get_null()?)?,
		}
		obj.set_named_property(
			"aborted",
			env.get_boolean(self.state.aborted.load(Ordering::Relaxed))?,
		)?;
		let errors = self
			.state
			.errors
			.lock()
			.map(|e| e.clone())
			.unwrap_or_default();
		obj.set_named_property("errorCount", env.create_int64(errors.len() as i64)?)?;
		Ok(obj)
	}

	/// Cooperative abort. The next syscall batch finishes, then the scan
	/// unwinds. The Promise returned by `start()` resolves with whatever
	/// partial tree was built — it does NOT reject. Callers can tell
	/// whether the scan completed normally by checking `progress().aborted`.
	#[napi]
	pub fn abort(&self) {
		self.state.aborted.store(true, Ordering::Relaxed);
	}
}

pub struct ScanTask {
	path: PathBuf,
	state: Arc<ScanState>,
}

impl Task for ScanTask {
	type Output = ScanResult;
	type JsValue = JsObject;

	fn compute(&mut self) -> Result<Self::Output> {
		run_scan(&self.path, &self.state)
			.map_err(|e| Error::from_reason(format!("scan failed: {e}")))
	}

	fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
		scan_result_to_js(&env, &output)
	}
}

fn scan_result_to_js(env: &Env, result: &ScanResult) -> Result<JsObject> {
	let mut obj = env.create_object()?;
	obj.set_named_property("root", vfs_node_to_js(env, &result.root)?)?;
	obj.set_named_property("counts", counts_to_js(env, &result.counts)?)?;
	obj.set_named_property("errors", errors_to_js(env, &result.errors)?)?;
	if let Some(perf) = &result.perf {
		obj.set_named_property("perf", perf_node_to_js(env, perf)?)?;
	} else {
		obj.set_named_property("perf", env.get_null()?)?;
	}
	Ok(obj)
}

fn vfs_node_to_js(env: &Env, node: &VfsNode) -> Result<JsObject> {
	let mut obj = env.create_object()?;
	match node {
		VfsNode::Directory {
			name,
			size,
			mtime,
			files,
		} => {
			obj.set_named_property("type", env.create_string("directory")?)?;
			obj.set_named_property("name", env.create_string(name)?)?;
			obj.set_named_property("size", env.create_int64(*size as i64)?)?;
			obj.set_named_property("mtime", env.create_int64(*mtime as i64)?)?;
			let mut arr = env.create_array_with_length(files.len())?;
			for (i, child) in files.iter().enumerate() {
				arr.set_element(i as u32, vfs_node_to_js(env, child)?)?;
			}
			obj.set_named_property("files", arr)?;
		}
		VfsNode::File { name, size, mtime } => {
			obj.set_named_property("type", env.create_string("file")?)?;
			obj.set_named_property("name", env.create_string(name)?)?;
			obj.set_named_property("size", env.create_int64(*size as i64)?)?;
			obj.set_named_property("mtime", env.create_int64(*mtime as i64)?)?;
		}
	}
	Ok(obj)
}

fn counts_to_js(env: &Env, c: &CountsSnapshot) -> Result<JsObject> {
	let mut obj = env.create_object()?;
	obj.set_named_property("files", env.create_int64(c.files as i64)?)?;
	obj.set_named_property("directories", env.create_int64(c.directories as i64)?)?;
	obj.set_named_property("symlinks", env.create_int64(c.symlinks as i64)?)?;
	obj.set_named_property("devices", env.create_int64(c.devices as i64)?)?;
	obj.set_named_property("misc", env.create_int64(c.misc as i64)?)?;
	Ok(obj)
}

fn errors_to_js(env: &Env, errors: &[ScanError]) -> Result<JsObject> {
	let mut arr = env.create_array_with_length(errors.len())?;
	for (i, err) in errors.iter().enumerate() {
		let mut obj = env.create_object()?;
		obj.set_named_property("path", env.create_string(&err.path)?)?;
		obj.set_named_property(
			"kind",
			env.create_string(match err.kind {
				ScanErrorKind::Permission => "permission",
				ScanErrorKind::Missing => "missing",
				ScanErrorKind::Loop => "loop",
				ScanErrorKind::Other => "other",
			})?,
		)?;
		match &err.code {
			Some(c) => obj.set_named_property("code", env.create_string(c)?)?,
			None => obj.set_named_property("code", env.get_null()?)?,
		};
		obj.set_named_property("message", env.create_string(&err.message)?)?;
		arr.set_element(i as u32, obj)?;
	}
	Ok(arr)
}

fn perf_node_to_js(env: &Env, perf: &PerfNode) -> Result<JsObject> {
	let mut obj = env.create_object()?;
	obj.set_named_property("name", env.create_string(&perf.name)?)?;
	obj.set_named_property("path", env.create_string(&perf.path)?)?;
	obj.set_named_property("totalMs", env.create_double(perf.total_ms)?)?;
	obj.set_named_property("elapsedMs", env.create_double(perf.elapsed_ms)?)?;
	obj.set_named_property("selfMs", env.create_double(perf.self_ms)?)?;
	obj.set_named_property("readdirMs", env.create_double(perf.readdir_ms)?)?;
	obj.set_named_property("entryCount", env.create_int64(perf.entry_count as i64)?)?;
	obj.set_named_property("depth", env.create_int64(perf.depth as i64)?)?;
	obj.set_named_property("inProgress", env.get_boolean(perf.in_progress)?)?;
	let mut arr = env.create_array_with_length(perf.children.len())?;
	for (i, child) in perf.children.iter().enumerate() {
		arr.set_element(i as u32, perf_node_to_js(env, child)?)?;
	}
	obj.set_named_property("children", arr)?;
	Ok(obj)
}
