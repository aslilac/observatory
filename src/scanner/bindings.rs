// N-API exports for the scanner.
//
// The surface is one class, `Scan`, plus `volumes()` (see volumes.rs).
// A `Scan` is a handle that walks a directory on libuv's threadpool (via
// napi-rs AsyncTask, so the JS main thread stays free to handle IPC),
// reports progress while it runs, and then holds on to the finished tree.
// The tree itself never crosses into JS (see tree.rs); the main process asks
// the handle for the slices it needs instead.
//
// Results come back as JSON strings for the JS side to parse. V8's
// JSON.parse is optimized C++, where building the same objects through
// N-API is one round trip across the binding per property. The exceptions
// are small and frequently polled: the progress snapshot, built directly
// below, and the list of volumes.

use crate::{
	CountsSnapshot, PerfNode, Reserved, ScanError, ScanResult, ScanState, VfsNode, run_scan,
	snapshot_perf, tree, volumes::Volume,
};
use napi::bindgen_prelude::*;
use napi::{Env, JsObject, JsString, Task};
use napi_derive::napi;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

type SharedTree = Arc<RwLock<Option<VfsNode>>>;

#[napi(object)]
pub struct ScanOptions {
	pub perf: Option<bool>,
}

#[napi]
pub struct Scan {
	path: PathBuf,
	state: Arc<ScanState>,
	// Filled in when the walk finishes, and kept until `release()`.
	tree: SharedTree,
}

#[napi]
impl Scan {
	#[napi(constructor)]
	pub fn new(path: String, options: Option<ScanOptions>) -> Result<Self> {
		let perf = options.and_then(|o| o.perf).unwrap_or(false);
		// Stat the root up-front the same way `scan()` does. Failing here
		// gives the caller a clean rejection before any background work
		// starts (e.g. user passed a non-existent path).
		let state = ScanState::for_path(path.as_ref(), perf)
			.map_err(|e| Error::from_reason(format!("stat failed: {e}")))?;
		Ok(Self {
			path: PathBuf::from(path),
			state: Arc::new(state),
			tree: SharedTree::default(),
		})
	}

	/// A handle that has already finished, holding `json` (a VfsNode) as its
	/// tree. For the dev-only fake disk, which is built in JS.
	#[napi(factory)]
	pub fn from_json(json: String) -> Result<Self> {
		let root: VfsNode = serde_json::from_str(&json)
			.map_err(|e| Error::from_reason(format!("not a scan tree: {e}")))?;
		Ok(Self {
			path: PathBuf::new(),
			state: Arc::new(ScanState::new(false)),
			tree: Arc::new(RwLock::new(Some(root))),
		})
	}

	/// Kick off the scan on libuv's threadpool. The Promise resolves to a
	/// JSON summary (counts, errors, perf tree); the tree itself stays on
	/// this handle. Safe to call only once per Scan instance — subsequent
	/// calls will start a second scan that shares the same state and
	/// produce confusing results.
	#[napi]
	pub fn start(&self) -> AsyncTask<ScanTask> {
		AsyncTask::new(ScanTask {
			path: self.path.clone(),
			state: Arc::clone(&self.state),
			tree: Arc::clone(&self.tree),
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
		obj.set_named_property("counts", counts_to_js(&env, &self.state.counts.snapshot())?)?;
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
	/// unwinds. The Promise returned by `start()` still resolves rather
	/// than rejecting, but the partial tree is dropped: an aborted scan's
	/// handle is on its way out.
	#[napi]
	pub fn abort(&self) {
		self.state.aborted.store(true, Ordering::Relaxed);
	}

	/// The finished tree's size in bytes; null until there is one.
	#[napi]
	pub fn size(&self) -> Option<f64> {
		read(&self.tree).as_ref().map(|root| root.size() as f64)
	}

	/// JSON for what the renderer draws of the directory at `cursor` (a
	/// `tree::RenderSlice`), or `null` before the scan finishes or if the
	/// cursor doesn't lead to a directory.
	#[napi]
	pub fn render_tree(&self, cursor: Vec<String>) -> Result<String> {
		let root = read(&self.tree);
		let slice = root
			.as_ref()
			.and_then(|root| tree::render_slice(root, &cursor));
		serde_json::to_string(&slice)
			.map_err(|e| Error::from_reason(format!("serialize failed: {e}")))
	}

	/// Searches the tree on libuv's threadpool, since it visits every node.
	/// Resolves to JSON for a `tree::SearchResults` with paths under
	/// `base_path`, or `null` before the scan finishes.
	#[napi]
	pub fn search(&self, base_path: String, query: String) -> AsyncTask<SearchTask> {
		AsyncTask::new(SearchTask {
			tree: Arc::clone(&self.tree),
			base_path,
			query,
		})
	}

	/// Takes the entry at `parts` (names below the root) out of the tree,
	/// e.g. once it's been moved to the trash. False if it wasn't there.
	#[napi]
	pub fn remove(&self, parts: Vec<String>) -> bool {
		write(&self.tree)
			.as_mut()
			.is_some_and(|root| tree::remove(root, &parts))
	}

	/// Frees the tree. A whole disk's worth is hundreds of MB that V8 can't
	/// see, so it won't hurry to collect this small handle on its own.
	/// Millions of nodes take a moment to free, so that happens off the
	/// calling thread.
	#[napi]
	pub fn release(&self) {
		let root = write(&self.tree).take();
		if root.is_some() {
			std::thread::spawn(move || drop(root));
		}
	}
}

/// The disks and network shares there are to scan. Only reads what the OS
/// already knows, so it's quick and never waits on a file server.
#[napi]
pub fn volumes() -> Vec<Volume> {
	crate::volumes::volumes()
}

// Nothing panics partway through changing the tree while holding the lock,
// so a poisoned lock still guards a whole tree.
fn read(tree: &SharedTree) -> RwLockReadGuard<'_, Option<VfsNode>> {
	tree.read().unwrap_or_else(PoisonError::into_inner)
}

fn write(tree: &SharedTree) -> RwLockWriteGuard<'_, Option<VfsNode>> {
	tree.write().unwrap_or_else(PoisonError::into_inner)
}

pub struct ScanTask {
	path: PathBuf,
	state: Arc<ScanState>,
	tree: SharedTree,
}

// Everything in a ScanResult but the tree, which stays on the handle.
#[derive(Serialize)]
struct ScanSummary {
	reserved: Vec<Reserved>,
	counts: CountsSnapshot,
	errors: Vec<ScanError>,
	perf: Option<PerfNode>,
}

impl Task for ScanTask {
	type Output = String;
	type JsValue = JsString;

	fn compute(&mut self) -> Result<Self::Output> {
		let ScanResult {
			root,
			reserved,
			counts,
			errors,
			perf,
		} = run_scan(&self.path, &self.state)
			.map_err(|e| Error::from_reason(format!("scan failed: {e}")))?;
		// Checked under the lock, so a `release()` right after `abort()` can't
		// slip in ahead of this and leave the tree behind.
		let mut tree = write(&self.tree);
		if !self.state.aborted.load(Ordering::Relaxed) {
			*tree = Some(root);
		}
		drop(tree);
		serde_json::to_string(&ScanSummary {
			reserved,
			counts,
			errors,
			perf,
		})
		.map_err(|e| Error::from_reason(format!("serialize failed: {e}")))
	}

	fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
		env.create_string(&output)
	}
}

pub struct SearchTask {
	tree: SharedTree,
	base_path: String,
	query: String,
}

impl Task for SearchTask {
	type Output = String;
	type JsValue = JsString;

	fn compute(&mut self) -> Result<Self::Output> {
		let root = read(&self.tree);
		let results = root
			.as_ref()
			.map(|root| tree::search(root, &self.base_path, &self.query));
		serde_json::to_string(&results)
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
