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
	CountsSnapshot, PerfNode, ScanState, root_dev_id, run_scan, snapshot_perf,
};
use napi::bindgen_prelude::*;
use napi::{Env, JsObject, JsString, Task};
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
	/// directory boundaries. When the scan was started with `perf: true`,
	/// `perfTree` is the live snapshot of the flame-graph tree —
	/// in-progress nodes have `inProgress: true` and `totalMs` computed
	/// from wall time since entry.
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
		// Live perf snapshot. Cheap-ish (a brief Mutex per node, then JS
		// object construction); typical PerfNodeShared trees are <10K
		// nodes even on deep scans. Callers that don't want the cost
		// can simply not poll while OB_PERF is off — when state.perf is
		// false, live_perf stays None and we emit null.
		let perf_snapshot = self
			.state
			.live_perf
			.lock()
			.ok()
			.and_then(|g| g.as_ref().map(|n| snapshot_perf(n)));
		match perf_snapshot {
			Some(p) => obj.set_named_property("perfTree", perf_node_to_js(&env, &p)?)?,
			None => obj.set_named_property("perfTree", env.get_null()?)?,
		}
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

// The final ScanResult is shipped to JS as a JSON string. Serialization
// runs on the libuv worker thread (inside `compute`); the JS side does
// `JSON.parse` on the result. Counter-intuitively this is faster than
// building V8 objects via the N-API one set_named_property at a time —
// V8's JSON parser runs in optimized C++ once it owns the buffer, while
// per-property napi calls round-trip through the binding boundary each
// time. For a 170K-entry scan the napi-walk approach blocked the JS
// thread for ~115ms at resolve time; the JSON path moves most of that
// work onto the worker.
pub struct ScanTask {
	path: PathBuf,
	state: Arc<ScanState>,
}

impl Task for ScanTask {
	type Output = String;
	type JsValue = JsString;

	fn compute(&mut self) -> Result<Self::Output> {
		let result = run_scan(&self.path, &self.state)
			.map_err(|e| Error::from_reason(format!("scan failed: {e}")))?;
		serde_json::to_string(&result)
			.map_err(|e| Error::from_reason(format!("serialize failed: {e}")))
	}

	fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
		env.create_string(&output)
	}
}

// Used by Scan::progress(). The progress payload is tiny (counts + a
// path + a bool + a perf snapshot when enabled) so building it as a JS
// object directly is faster than round-tripping through JSON.parse.
fn counts_to_js(env: &Env, c: &CountsSnapshot) -> Result<JsObject> {
	let mut obj = env.create_object()?;
	obj.set_named_property("files", env.create_int64(c.files as i64)?)?;
	obj.set_named_property("directories", env.create_int64(c.directories as i64)?)?;
	obj.set_named_property("symlinks", env.create_int64(c.symlinks as i64)?)?;
	obj.set_named_property("devices", env.create_int64(c.devices as i64)?)?;
	obj.set_named_property("misc", env.create_int64(c.misc as i64)?)?;
	Ok(obj)
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
