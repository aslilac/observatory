// Synchronous parallel filesystem scanner.
//
// One sequential `read_dir` per directory, then per-entry metadata lookups
// and subdirectory recursion fanned out through rayon's work-stealing pool.
// No async, no tokio — Linux/macOS metadata syscalls don't have meaningful
// async equivalents anyway.
//
// Output mirrors the `Ob.VfsDirectory` / `Ob.ScanError` / `Ob.PerfNode`
// shapes from `src/@types/Observatory.d.ts` so a future napi-rs binding
// (or child-process JSON bridge) can hand the result straight to the
// renderer with no reshaping.
//
// Platform parity with the JS scanner:
// - Linux: skip /dev and /proc by absolute path; refuse cross-device
//   descent so procfs / sysfs / tmpfs / network shares don't double-count
// - macOS: skip the Catalina+ firmlink shadow paths (/Volumes,
//   /System/Volumes, /private/var/db/dyld) and anything under
//   /System/Volumes/*. The generic cross-device check is intentionally
//   skipped on macOS because firmlinks make stat("/") return the data
//   volume, which would otherwise filter out /Users.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp;
use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

#[derive(Default)]
pub struct Counts {
	pub files: AtomicU64,
	pub directories: AtomicU64,
	pub symlinks: AtomicU64,
	pub devices: AtomicU64,
	pub misc: AtomicU64,
}

impl Counts {
	pub fn snapshot(&self) -> CountsSnapshot {
		CountsSnapshot {
			files: self.files.load(Ordering::Relaxed),
			directories: self.directories.load(Ordering::Relaxed),
			symlinks: self.symlinks.load(Ordering::Relaxed),
			devices: self.devices.load(Ordering::Relaxed),
			misc: self.misc.load(Ordering::Relaxed),
		}
	}
}

#[derive(Serialize, Debug, Clone, Copy)]
pub struct CountsSnapshot {
	pub files: u64,
	pub directories: u64,
	pub symlinks: u64,
	pub devices: u64,
	pub misc: u64,
}

impl CountsSnapshot {
	pub fn total_entries(&self) -> u64 {
		self.files + self.directories + self.symlinks + self.devices + self.misc
	}
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum VfsNode {
	Directory {
		name: String,
		size: u64,
		mtime: u64,
		files: Vec<VfsNode>,
	},
	File {
		name: String,
		size: u64,
		mtime: u64,
	},
}

impl VfsNode {
	pub fn name(&self) -> &str {
		match self {
			VfsNode::Directory { name, .. } | VfsNode::File { name, .. } => name,
		}
	}

	pub fn size(&self) -> u64 {
		match self {
			VfsNode::Directory { size, .. } | VfsNode::File { size, .. } => *size,
		}
	}

	pub fn mtime(&self) -> u64 {
		match self {
			VfsNode::Directory { mtime, .. } | VfsNode::File { mtime, .. } => *mtime,
		}
	}
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ScanErrorKind {
	Permission,
	// macOS privacy protection kept the scan out (Mail, Messages, Desktop,
	// other apps' data, …). Granting Full Disk Access lets it in.
	Protected,
	Missing,
	Loop,
	Other,
}

#[derive(Serialize, Debug, Clone)]
pub struct ScanError {
	pub path: String,
	pub kind: ScanErrorKind,
	pub code: Option<String>,
	pub message: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfNode {
	pub name: String,
	pub path: String,
	pub total_ms: f64,
	pub elapsed_ms: f64,
	pub self_ms: f64,
	pub readdir_ms: f64,
	pub entry_count: u64,
	pub depth: u64,
	pub in_progress: bool,
	pub children: Vec<PerfNode>,
}

// The live, mutable perf tree built during a scan. Wrapped in Arc<Mutex>
// per-node so the JS side polling `Scan::progress()` can take a snapshot
// at any time without coordinating with the threadpool worker. Each scan
// builds nodes top-down (created on `scan_dir` entry, registered with the
// parent) and settles them bottom-up (totals written on exit). `snapshot`
// walks this graph to produce the serializable `PerfNode` form — for
// in-progress nodes, `total_ms` is computed from wall time since `start`.
pub struct PerfNodeShared {
	data: Mutex<PerfNodeData>,
}

struct PerfNodeData {
	name: String,
	path: String,
	depth: u64,
	start: Instant,
	total_ms: f64,
	readdir_ms: f64,
	entry_count: u64,
	in_progress: bool,
	children: Vec<Arc<PerfNodeShared>>,
}

impl PerfNodeShared {
	fn new(name: String, path: String, depth: u64) -> Arc<Self> {
		Arc::new(Self {
			data: Mutex::new(PerfNodeData {
				name,
				path,
				depth,
				start: Instant::now(),
				total_ms: 0.0,
				readdir_ms: 0.0,
				entry_count: 0,
				in_progress: true,
				children: Vec::new(),
			}),
		})
	}

	fn settle(&self, readdir_ms: f64, entry_count: u64) {
		if let Ok(mut d) = self.data.lock() {
			d.total_ms = d.start.elapsed().as_secs_f64() * 1000.0;
			d.readdir_ms = readdir_ms;
			d.entry_count = entry_count;
			d.in_progress = false;
		}
	}

	fn attach_child(&self, child: &Arc<PerfNodeShared>) {
		if let Ok(mut d) = self.data.lock() {
			d.children.push(Arc::clone(child));
		}
	}
}

pub fn snapshot_perf(root: &PerfNodeShared) -> PerfNode {
	snapshot_perf_at(root, Instant::now())
}

fn snapshot_perf_at(node: &PerfNodeShared, now: Instant) -> PerfNode {
	let data = node.data.lock().expect("perf node mutex poisoned");
	let total_ms = if data.in_progress {
		(now - data.start).as_secs_f64() * 1000.0
	} else {
		data.total_ms
	};
	let children: Vec<PerfNode> = data
		.children
		.iter()
		.map(|c| snapshot_perf_at(c, now))
		.collect();
	let max_child = children.iter().map(|c| c.total_ms).fold(0f64, f64::max);
	PerfNode {
		name: data.name.clone(),
		path: data.path.clone(),
		total_ms,
		elapsed_ms: total_ms,
		self_ms: (total_ms - max_child).max(0.0),
		readdir_ms: data.readdir_ms,
		entry_count: data.entry_count,
		depth: data.depth,
		in_progress: data.in_progress,
		children,
	}
}

#[derive(Serialize, Debug)]
pub struct ScanResult {
	pub root: VfsNode,
	pub counts: CountsSnapshot,
	pub errors: Vec<ScanError>,
	// Serialized as `null` when perf isn't enabled — matches the
	// `Ob.PerfNode | null` shape on the JS side and keeps the JSON
	// schema stable regardless of OB_PERF.
	pub perf: Option<PerfNode>,
}

#[derive(Default, Clone, Copy)]
pub struct ScanConfig {
	pub perf: bool,
}

// Shared scan state. Lives in an `Arc` so the napi `Scan` handle can read
// counts / currentPath / errors from the JS thread while the scan is still
// running on a libuv worker. Counts are lockless (AtomicU64); the
// short-lived locks on `current_path` and `errors` only contend for a few
// µs at directory boundaries and won't stall progress polling.
pub struct ScanState {
	pub counts: Counts,
	pub current_path: Mutex<Option<String>>,
	pub errors: Mutex<Vec<ScanError>>,
	pub aborted: AtomicBool,
	pub root_dev: Option<u64>,
	// Checked once up front; macOS only applies a change on relaunch anyway.
	pub full_disk_access: bool,
	pub perf: bool,
	// Root of the live perf tree, set on the first scan_dir call when perf
	// is enabled. None while the scan hasn't started or perf is off.
	pub live_perf: Mutex<Option<Arc<PerfNodeShared>>>,
}

impl ScanState {
	pub fn new(perf: bool, root_dev: Option<u64>) -> Self {
		Self {
			counts: Counts::default(),
			current_path: Mutex::new(None),
			errors: Mutex::new(Vec::new()),
			aborted: AtomicBool::new(false),
			root_dev,
			full_disk_access: has_full_disk_access(),
			perf,
			live_perf: Mutex::new(None),
		}
	}
}

pub fn scan(path: &Path, config: ScanConfig) -> std::io::Result<ScanResult> {
	// Resolve root dev via stat (follows symlinks), matching what the JS
	// scanner does in `_performScan`. Errors here propagate to the caller —
	// we can't meaningfully scan a path we can't stat.
	let root_meta = fs::metadata(path)?;
	let root_dev = root_dev_id(&root_meta);

	let state = ScanState::new(config.perf, root_dev);
	run_scan(path, &state)
}

// Internal entry point used by both the free `scan()` function and the
// napi `Scan` class. Takes a borrowed ScanState so the class can pre-build
// one, share it via Arc, and pull progress from the JS thread.
pub fn run_scan(path: &Path, state: &ScanState) -> std::io::Result<ScanResult> {
	let node = scan_dir(path, 0, state, None);
	let perf = state
		.live_perf
		.lock()
		.ok()
		.and_then(|g| g.as_ref().map(|n| snapshot_perf(n)));

	Ok(ScanResult {
		root: node,
		counts: state.counts.snapshot(),
		errors: state.errors.lock().map(|e| e.clone()).unwrap_or_default(),
		perf,
	})
}

#[cfg(unix)]
pub fn root_dev_id(meta: &fs::Metadata) -> Option<u64> {
	Some(meta.dev())
}

#[cfg(not(unix))]
pub fn root_dev_id(_meta: &fs::Metadata) -> Option<u64> {
	None
}

#[cfg(unix)]
fn entry_dev_id(meta: &fs::Metadata) -> Option<u64> {
	Some(meta.dev())
}

#[cfg(not(unix))]
fn entry_dev_id(_meta: &fs::Metadata) -> Option<u64> {
	None
}

fn scan_dir(
	path: &Path,
	depth: u64,
	state: &ScanState,
	parent_perf: Option<&Arc<PerfNodeShared>>,
) -> VfsNode {
	let display_name = path
		.file_name()
		.map(|n| n.to_string_lossy().into_owned())
		.unwrap_or_else(|| path.to_string_lossy().into_owned());
	let display_path = path.to_string_lossy().into_owned();

	// Update currentPath so the JS side polling `progress()` sees roughly
	// where we are. Recursion is parallel via rayon, so this is "the most
	// recently entered directory on any thread" rather than a precise BFS
	// frontier — good enough for a status line, matches the JS behavior.
	if let Ok(mut cp) = state.current_path.lock() {
		*cp = Some(display_path.clone());
	}

	// Register an in-progress perf node so live snapshots of state.live_perf
	// see this directory immediately. Settled below before we return.
	let my_perf = if state.perf {
		let node = PerfNodeShared::new(display_name.clone(), display_path.clone(), depth);
		match parent_perf {
			Some(parent) => parent.attach_child(&node),
			None => {
				if let Ok(mut root) = state.live_perf.lock() {
					*root = Some(Arc::clone(&node));
				}
			}
		}
		Some(node)
	} else {
		None
	};

	if state.aborted.load(Ordering::Relaxed) {
		if let Some(ref n) = my_perf {
			n.settle(0.0, 0);
		}
		return VfsNode::Directory {
			name: display_name,
			size: 0,
			mtime: 0,
			files: vec![],
		};
	}

	let readdir_start = if state.perf {
		Some(Instant::now())
	} else {
		None
	};
	let entries: Vec<_> = match retry_interrupted(|| fs::read_dir(path)) {
		Ok(rd) => rd.filter_map(Result::ok).collect(),
		Err(err) => {
			record_error(state, path, depth, &err);
			if let Some(ref n) = my_perf {
				let readdir_ms = readdir_start
					.map(|t| t.elapsed().as_secs_f64() * 1000.0)
					.unwrap_or(0.0);
				n.settle(readdir_ms, 0);
			}
			return VfsNode::Directory {
				name: display_name,
				size: 0,
				mtime: 0,
				files: vec![],
			};
		}
	};
	let entry_count = entries.len() as u64;
	let readdir_ms = readdir_start
		.map(|t| t.elapsed().as_secs_f64() * 1000.0)
		.unwrap_or(0.0);

	let mut children: Vec<VfsNode> = entries
		.into_par_iter()
		.filter_map(|entry| classify(entry, depth + 1, state, my_perf.as_ref()))
		.collect();

	children.sort_by_key(|b| cmp::Reverse(b.size()));
	let size = children.iter().map(|n| n.size()).sum();
	let mtime = children.iter().map(|n| n.mtime()).max().unwrap_or(0);

	if let Some(ref n) = my_perf {
		n.settle(readdir_ms, entry_count);
	}

	VfsNode::Directory {
		name: display_name,
		size,
		mtime,
		files: children,
	}
}

// `DirEntry::metadata` does not follow symlinks (lstat semantics) — matches
// what the JS scanner uses for entry-level decisions.
fn classify(
	entry: fs::DirEntry,
	depth: u64,
	state: &ScanState,
	parent_perf: Option<&Arc<PerfNodeShared>>,
) -> Option<VfsNode> {
	if state.aborted.load(Ordering::Relaxed) {
		return None;
	}
	let entry_path = entry.path();
	let meta = match retry_interrupted(|| entry.metadata()) {
		Ok(m) => m,
		Err(err) => {
			record_error(state, &entry_path, depth, &err);
			return None;
		}
	};

	let entry_name = entry.file_name().to_string_lossy().into_owned();
	let mtime = meta
		.modified()
		.ok()
		.and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
		.map(|d| d.as_millis() as u64)
		.unwrap_or(0);
	let ft = meta.file_type();

	if ft.is_file() {
		state.counts.files.fetch_add(1, Ordering::Relaxed);
		Some(VfsNode::File {
			name: entry_name,
			size: disk_usage(&meta),
			mtime,
		})
	} else if ft.is_dir() {
		state.counts.directories.fetch_add(1, Ordering::Relaxed);
		if should_skip_dir(&entry_path, entry_dev_id(&meta), state.root_dev) {
			return None;
		}
		let node = scan_dir(&entry_path, depth, state, parent_perf);
		// scan_dir derives the name from the path's basename; for entries
		// we already know the parent-yielded name, which is what the
		// renderer uses. Rewrite to be safe.
		Some(rename(node, entry_name))
	} else if ft.is_symlink() {
		state.counts.symlinks.fetch_add(1, Ordering::Relaxed);
		None
	} else {
		#[cfg(unix)]
		{
			use std::os::unix::fs::FileTypeExt;
			if ft.is_block_device() || ft.is_char_device() {
				state.counts.devices.fetch_add(1, Ordering::Relaxed);
				return None;
			}
		}
		state.counts.misc.fetch_add(1, Ordering::Relaxed);
		None
	}
}

// Space the file takes up on disk rather than its length. The two differ
// most for sparse files: a Docker or VM disk image can claim hundreds of GB
// it has never written, and counting its length puts the disk past full.
// APFS compression and partly filled last blocks move it a little too.
// This is what du, Finder and DaisyDisk count. `st_blocks` is in 512-byte
// units whatever the filesystem's block size.
#[cfg(unix)]
fn disk_usage(meta: &fs::Metadata) -> u64 {
	meta.blocks() * 512
}

// std doesn't expose allocation sizes on Windows.
#[cfg(not(unix))]
fn disk_usage(meta: &fs::Metadata) -> u64 {
	meta.len()
}

// Reads that come back EINTR (seen inside app containers on macOS) go
// through when tried again.
fn retry_interrupted<T>(mut f: impl FnMut() -> io::Result<T>) -> io::Result<T> {
	let mut tries = 1;
	loop {
		match f() {
			Err(err) if err.kind() == io::ErrorKind::Interrupted && tries < 5 => tries += 1,
			result => return result,
		}
	}
}

fn rename(node: VfsNode, new_name: String) -> VfsNode {
	match node {
		VfsNode::Directory {
			size, mtime, files, ..
		} => VfsNode::Directory {
			name: new_name,
			size,
			mtime,
			files,
		},
		VfsNode::File { size, mtime, .. } => VfsNode::File {
			name: new_name,
			size,
			mtime,
		},
	}
}

fn should_skip_dir(path: &Path, _dev: Option<u64>, _root_dev: Option<u64>) -> bool {
	#[cfg(target_os = "macos")]
	{
		let s = path.to_string_lossy();
		// Catalina+ firmlink shadow paths — recursing into any of these
		// duplicates content reachable via the firmlinked root.
		if matches!(
			s.as_ref(),
			"/Volumes" | "/System/Volumes" | "/private/var/db/dyld" | "/dev"
		) {
			return true;
		}
		if s.starts_with("/System/Volumes/") {
			return true;
		}
	}

	#[cfg(target_os = "linux")]
	{
		let s = path.to_string_lossy();
		if matches!(s.as_ref(), "/dev" | "/proc") {
			return true;
		}
	}

	// Generic cross-device skip on every platform except macOS. macOS firmlinks
	// make stat("/") report the data volume, which would filter out /Users
	// by dev id even though it's "the same disk" from the user's perspective.
	#[cfg(not(target_os = "macos"))]
	{
		if let (Some(d), Some(rd)) = (_dev, _root_dev) {
			if d != rd {
				return true;
			}
		}
	}

	false
}

// `depth` is `target`'s below the scan root. The root's own failure is
// always reported: it's the only explanation for an empty scan.
fn record_error(state: &ScanState, target: &Path, depth: u64, err: &io::Error) {
	if depth > 0 && is_expected_denial(state, target, err) {
		return;
	}
	let (kind, code) = classify_error(state, err);
	let scan_err = ScanError {
		path: target.to_string_lossy().into_owned(),
		kind,
		code,
		message: err.to_string(),
	};
	if let Ok(mut errors) = state.errors.lock() {
		errors.push(scan_err);
	}
}

// Folders that are locked the same way on every machine like this one, and
// that nothing short of running as root would open, aren't worth an issue
// each. A whole-disk scan turns up hundreds, mostly in /private/var.
// - Another account owns it (root, or a service account like _spotlight):
//   it's private by design.
// - A refusal by macOS policy that Full Disk Access wouldn't lift: any, once
//   the app has it, and those outside the user's home folder regardless.
//   That's System Integrity Protection, and Apple's data vaults (some in
//   ~/Library, more in the user's temporary folders under
//   /private/var/folders). The rest, inside the home folder without Full
//   Disk Access, are mostly privacy protection, which granting it lifts;
//   those are reported, as `Protected`.
#[cfg(unix)]
fn is_expected_denial(state: &ScanState, path: &Path, err: &io::Error) -> bool {
	if err.kind() != io::ErrorKind::PermissionDenied {
		return false;
	}
	// SAFETY: getuid has no preconditions and can't fail.
	let uid = unsafe { libc::getuid() };
	if fs::symlink_metadata(path).is_ok_and(|meta| meta.uid() != uid) {
		return true;
	}
	is_policy_refusal(err)
		&& (state.full_disk_access
			|| !std::env::home_dir().is_some_and(|home| path.starts_with(home)))
}

#[cfg(not(unix))]
fn is_expected_denial(_state: &ScanState, _path: &Path, _err: &io::Error) -> bool {
	false
}

// macOS answers EPERM, rather than the EACCES of a file's own permissions,
// when system policy refuses: privacy protection, System Integrity
// Protection, data vaults.
#[cfg(unix)]
fn is_policy_refusal(err: &io::Error) -> bool {
	cfg!(target_os = "macos") && err.raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn is_policy_refusal(_err: &io::Error) -> bool {
	false
}

// Whether this process has Full Disk Access, going by the usual tell: the
// user's own privacy database is off limits without it. Always false off
// macOS, which has no such thing.
fn has_full_disk_access() -> bool {
	cfg!(target_os = "macos")
		&& std::env::home_dir().is_some_and(|home| {
			fs::read_dir(home.join("Library/Application Support/com.apple.TCC")).is_ok()
		})
}

fn classify_error(state: &ScanState, err: &io::Error) -> (ScanErrorKind, Option<String>) {
	let raw = err.raw_os_error();
	let code = raw.and_then(errno_name);
	let kind = if code.as_deref() == Some("ELOOP") {
		ScanErrorKind::Loop
	} else {
		use std::io::ErrorKind::*;
		match err.kind() {
			PermissionDenied if is_policy_refusal(err) && !state.full_disk_access => {
				ScanErrorKind::Protected
			}
			PermissionDenied => ScanErrorKind::Permission,
			NotFound => ScanErrorKind::Missing,
			_ => ScanErrorKind::Other,
		}
	};
	(kind, code)
}

#[cfg(unix)]
fn errno_name(n: i32) -> Option<String> {
	let name = match n {
		x if x == libc::EACCES => "EACCES",
		x if x == libc::EPERM => "EPERM",
		x if x == libc::ENOENT => "ENOENT",
		x if x == libc::ELOOP => "ELOOP",
		x if x == libc::ENOTDIR => "ENOTDIR",
		x if x == libc::EISDIR => "EISDIR",
		x if x == libc::ENAMETOOLONG => "ENAMETOOLONG",
		x if x == libc::ENOMEM => "ENOMEM",
		x if x == libc::EIO => "EIO",
		_ => return Some(format!("E{n}")),
	};
	Some(name.to_string())
}

#[cfg(not(unix))]
fn errno_name(n: i32) -> Option<String> {
	Some(format!("E{n}"))
}

// N-API bindings — gated behind the `napi` feature so the CLI / unit tests
// can build without paying for the napi-rs link or its transitive deps.
// Build with: cargo build --release --lib --features napi
// Output is a cdylib (.so / .dylib / .dll) that becomes a .node when
// renamed; the bindings module's #[napi] functions are the entry points
// the wrapper JS sees.
#[cfg(feature = "napi")]
mod bindings;

pub mod tree;

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs::{self, File};
	use std::io::Write;
	use std::sync::atomic::AtomicU64;

	static COUNTER: AtomicU64 = AtomicU64::new(0);

	fn tmpdir(label: &str) -> std::path::PathBuf {
		let n = COUNTER.fetch_add(1, Ordering::Relaxed);
		let dir = std::env::temp_dir().join(format!(
			"observatory-scan-test-{}-{}-{}",
			std::process::id(),
			label,
			n,
		));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).unwrap();
		dir
	}

	fn write(path: &Path, bytes: usize) {
		let mut f = File::create(path).unwrap();
		f.write_all(&vec![0u8; bytes]).unwrap();
	}

	// What the scanner should count for a file: what the filesystem
	// allocated for it, which rounds up from what was written.
	fn on_disk(path: &Path) -> u64 {
		disk_usage(&fs::metadata(path).unwrap())
	}

	fn cleanup(dir: &Path) {
		// Restore perms on anything we may have chmod 0'd so rm -rf works.
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			for entry in walkdir_quiet(dir) {
				let _ = fs::set_permissions(&entry, fs::Permissions::from_mode(0o755));
			}
		}
		let _ = fs::remove_dir_all(dir);
	}

	#[cfg(unix)]
	fn walkdir_quiet(root: &Path) -> Vec<std::path::PathBuf> {
		let mut out = vec![root.to_path_buf()];
		if let Ok(rd) = fs::read_dir(root) {
			for e in rd.flatten() {
				let p = e.path();
				if p.is_dir() {
					out.extend(walkdir_quiet(&p));
				}
			}
		}
		out
	}

	#[test]
	fn scans_a_flat_directory() {
		let dir = tmpdir("flat");
		write(&dir.join("a.bin"), 100);
		write(&dir.join("b.bin"), 200);

		let result = scan(&dir, ScanConfig::default()).unwrap();
		assert_eq!(result.counts.files, 2);
		assert_eq!(result.counts.directories, 0);
		assert_eq!(
			result.root.size(),
			on_disk(&dir.join("a.bin")) + on_disk(&dir.join("b.bin")),
		);
		assert!(result.errors.is_empty());

		cleanup(&dir);
	}

	#[test]
	fn recurses_and_sums_subdirectories() {
		let dir = tmpdir("nested");
		let sub = dir.join("sub");
		fs::create_dir(&sub).unwrap();
		write(&sub.join("deep.bin"), 500);
		write(&dir.join("top.bin"), 100);

		let result = scan(&dir, ScanConfig::default()).unwrap();
		assert_eq!(result.counts.files, 2);
		assert_eq!(result.counts.directories, 1);
		assert_eq!(
			result.root.size(),
			on_disk(&sub.join("deep.bin")) + on_disk(&dir.join("top.bin")),
		);

		cleanup(&dir);
	}

	#[test]
	fn sorts_children_size_descending() {
		let dir = tmpdir("sorted");
		// Big enough apart to allocate different numbers of blocks.
		write(&dir.join("small.bin"), 10_000);
		write(&dir.join("big.bin"), 1_000_000);
		write(&dir.join("mid.bin"), 100_000);

		let result = scan(&dir, ScanConfig::default()).unwrap();
		if let VfsNode::Directory { files, .. } = &result.root {
			let names: Vec<&str> = files
				.iter()
				.map(|n| match n {
					VfsNode::File { name, .. } | VfsNode::Directory { name, .. } => name.as_str(),
				})
				.collect();
			assert_eq!(names, vec!["big.bin", "mid.bin", "small.bin"]);
		} else {
			panic!("root should be a directory");
		}

		cleanup(&dir);
	}

	#[test]
	#[cfg(unix)]
	fn counts_symlinks_but_skips_them() {
		let dir = tmpdir("links");
		write(&dir.join("real.bin"), 100);
		std::os::unix::fs::symlink(dir.join("real.bin"), dir.join("link.bin")).unwrap();

		let result = scan(&dir, ScanConfig::default()).unwrap();
		assert_eq!(result.counts.symlinks, 1);
		assert_eq!(result.counts.files, 1);
		assert_eq!(result.root.size(), on_disk(&dir.join("real.bin")));

		cleanup(&dir);
	}

	#[test]
	#[cfg(unix)]
	fn counts_sparse_files_by_what_they_allocate() {
		let dir = tmpdir("sparse");
		// A 1 GB disk image with nothing written to it yet.
		File::create(dir.join("disk.img"))
			.unwrap()
			.set_len(1 << 30)
			.unwrap();

		let result = scan(&dir, ScanConfig::default()).unwrap();
		assert!(
			result.root.size() < 1 << 20,
			"counted {} bytes",
			result.root.size(),
		);

		cleanup(&dir);
	}

	#[test]
	#[cfg(unix)]
	fn records_eacces_as_permission_error() {
		use std::os::unix::fs::PermissionsExt;

		// Running as uid 0 bypasses chmod 000 and breaks this test's premise.
		if unsafe { libc::geteuid() } == 0 {
			return;
		}

		let dir = tmpdir("perm");
		let locked = dir.join("locked");
		fs::create_dir(&locked).unwrap();
		write(&locked.join("inside.bin"), 10);
		fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

		let result = scan(&dir, ScanConfig::default()).unwrap();
		let perm: Vec<_> = result
			.errors
			.iter()
			.filter(|e| matches!(e.kind, ScanErrorKind::Permission))
			.collect();
		assert!(
			!perm.is_empty(),
			"expected a Permission error, got {:?}",
			result.errors,
		);
		assert!(perm.iter().any(|e| e.path == locked.to_string_lossy()));

		cleanup(&dir);
	}

	#[test]
	fn perf_tree_populated_when_enabled() {
		let dir = tmpdir("perf");
		let sub = dir.join("sub");
		fs::create_dir(&sub).unwrap();
		write(&sub.join("a.bin"), 100);

		let result = scan(&dir, ScanConfig { perf: true }).unwrap();
		let perf = result.perf.expect("perf node should be set");
		assert_eq!(perf.depth, 0);
		assert!(!perf.in_progress);
		assert!(perf.total_ms >= 0.0);
		assert_eq!(perf.entry_count, 1);
		assert_eq!(perf.children.len(), 1);
		assert_eq!(perf.children[0].depth, 1);
	}

	#[test]
	fn perf_tree_absent_by_default() {
		let dir = tmpdir("noperf");
		write(&dir.join("a.bin"), 10);

		let result = scan(&dir, ScanConfig::default()).unwrap();
		assert!(result.perf.is_none());

		cleanup(&dir);
	}
}
