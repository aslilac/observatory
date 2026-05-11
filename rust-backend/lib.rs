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
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
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

#[derive(Serialize, Debug, Clone)]
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

#[derive(Serialize, Debug)]
pub struct ScanResult {
	pub root: VfsNode,
	pub counts: CountsSnapshot,
	pub errors: Vec<ScanError>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub perf: Option<PerfNode>,
}

#[derive(Default, Clone, Copy)]
pub struct ScanConfig {
	pub perf: bool,
}

struct State {
	counts: Counts,
	errors: Mutex<Vec<ScanError>>,
	root_dev: Option<u64>,
	perf: bool,
}

pub fn scan(path: &Path, config: ScanConfig) -> std::io::Result<ScanResult> {
	// Resolve root dev via stat (follows symlinks), matching what the JS
	// scanner does in `_performScan`. Errors here propagate to the caller —
	// we can't meaningfully scan a path we can't stat.
	let root_meta = fs::metadata(path)?;
	let root_dev = root_dev_id(&root_meta);

	let state = State {
		counts: Counts::default(),
		errors: Mutex::new(Vec::new()),
		root_dev,
		perf: config.perf,
	};

	let DirResult { node, perf } = scan_dir(path, 0, &state);

	Ok(ScanResult {
		root: node,
		counts: state.counts.snapshot(),
		errors: state.errors.into_inner().unwrap_or_default(),
		perf,
	})
}

#[cfg(unix)]
fn root_dev_id(meta: &fs::Metadata) -> Option<u64> {
	Some(meta.dev())
}

#[cfg(not(unix))]
fn root_dev_id(_meta: &fs::Metadata) -> Option<u64> {
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

struct DirResult {
	node: VfsNode,
	perf: Option<PerfNode>,
}

struct EntryResult {
	node: VfsNode,
	perf: Option<PerfNode>,
}

fn scan_dir(path: &Path, depth: u64, state: &State) -> DirResult {
	let start = if state.perf { Some(Instant::now()) } else { None };

	let display_name = path
		.file_name()
		.map(|n| n.to_string_lossy().into_owned())
		.unwrap_or_else(|| path.to_string_lossy().into_owned());
	let display_path = path.to_string_lossy().into_owned();

	let readdir_start = if state.perf { Some(Instant::now()) } else { None };
	let entries: Vec<_> = match fs::read_dir(path) {
		Ok(rd) => rd.filter_map(Result::ok).collect(),
		Err(err) => {
			record_error(state, path, &err);
			return DirResult {
				node: VfsNode::Directory {
					name: display_name.clone(),
					size: 0,
					mtime: 0,
					files: vec![],
				},
				perf: build_perf_node(
					state, &display_name, &display_path, depth, start, readdir_start, 0,
					vec![],
				),
			};
		}
	};
	let entry_count = entries.len() as u64;
	let readdir_ms = readdir_start.map(|t| t.elapsed().as_secs_f64() * 1000.0);

	let results: Vec<EntryResult> = entries
		.into_par_iter()
		.filter_map(|entry| classify(entry, depth + 1, state))
		.collect();

	let mut children: Vec<VfsNode> = Vec::with_capacity(results.len());
	let mut child_perf: Vec<PerfNode> = Vec::new();
	for r in results {
		children.push(r.node);
		if let Some(p) = r.perf {
			child_perf.push(p);
		}
	}

	children.sort_by(|a, b| b.size().cmp(&a.size()));
	let size = children.iter().map(|n| n.size()).sum();
	let mtime = children.iter().map(|n| n.mtime()).max().unwrap_or(0);

	let perf = if state.perf {
		let total_ms = start.unwrap().elapsed().as_secs_f64() * 1000.0;
		let max_child_total = child_perf
			.iter()
			.map(|c| c.total_ms)
			.fold(0f64, f64::max);
		Some(PerfNode {
			name: display_name.clone(),
			path: display_path,
			total_ms,
			elapsed_ms: total_ms,
			self_ms: (total_ms - max_child_total).max(0.0),
			readdir_ms: readdir_ms.unwrap_or(0.0),
			entry_count,
			depth,
			in_progress: false,
			children: child_perf,
		})
	} else {
		None
	};

	DirResult {
		node: VfsNode::Directory {
			name: display_name,
			size,
			mtime,
			files: children,
		},
		perf,
	}
}

// Stand up a perf node for an early-return (read_dir failed) directory, so
// the flame graph still shows we tried.
fn build_perf_node(
	state: &State,
	name: &str,
	path: &str,
	depth: u64,
	start: Option<Instant>,
	readdir_start: Option<Instant>,
	entry_count: u64,
	children: Vec<PerfNode>,
) -> Option<PerfNode> {
	if !state.perf {
		return None;
	}
	let total_ms = start.map(|t| t.elapsed().as_secs_f64() * 1000.0).unwrap_or(0.0);
	let readdir_ms = readdir_start
		.map(|t| t.elapsed().as_secs_f64() * 1000.0)
		.unwrap_or(0.0);
	Some(PerfNode {
		name: name.to_string(),
		path: path.to_string(),
		total_ms,
		elapsed_ms: total_ms,
		self_ms: total_ms,
		readdir_ms,
		entry_count,
		depth,
		in_progress: false,
		children,
	})
}

// `DirEntry::metadata` does not follow symlinks (lstat semantics) — matches
// what the JS scanner uses for entry-level decisions.
fn classify(entry: fs::DirEntry, depth: u64, state: &State) -> Option<EntryResult> {
	let entry_path = entry.path();
	let meta = match entry.metadata() {
		Ok(m) => m,
		Err(err) => {
			record_error(state, &entry_path, &err);
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
		Some(EntryResult {
			node: VfsNode::File {
				name: entry_name,
				size: meta.len(),
				mtime,
			},
			perf: None,
		})
	} else if ft.is_dir() {
		state.counts.directories.fetch_add(1, Ordering::Relaxed);
		if should_skip_dir(&entry_path, entry_dev_id(&meta), state.root_dev) {
			return None;
		}
		let DirResult { node, perf } = scan_dir(&entry_path, depth, state);
		// scan_dir derives the name from the path's basename; for entries
		// we already know the parent-yielded name, which is what the
		// renderer uses. Rewrite to be safe.
		Some(EntryResult {
			node: rename(node, entry_name),
			perf,
		})
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

fn rename(node: VfsNode, new_name: String) -> VfsNode {
	match node {
		VfsNode::Directory {
			size,
			mtime,
			files,
			..
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
			"/Volumes" | "/System/Volumes" | "/private/var/db/dyld"
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

fn record_error(state: &State, target: &Path, err: &std::io::Error) {
	let (kind, code) = classify_error(err);
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

fn classify_error(err: &std::io::Error) -> (ScanErrorKind, Option<String>) {
	let raw = err.raw_os_error();
	let code = raw.and_then(errno_name);
	let kind = if code.as_deref() == Some("ELOOP") {
		ScanErrorKind::Loop
	} else {
		use std::io::ErrorKind::*;
		match err.kind() {
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
		assert_eq!(result.root.size(), 300);
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
		assert_eq!(result.root.size(), 600);

		cleanup(&dir);
	}

	#[test]
	fn sorts_children_size_descending() {
		let dir = tmpdir("sorted");
		write(&dir.join("small.bin"), 10);
		write(&dir.join("big.bin"), 1000);
		write(&dir.join("mid.bin"), 100);

		let result = scan(&dir, ScanConfig::default()).unwrap();
		if let VfsNode::Directory { files, .. } = &result.root {
			let names: Vec<&str> = files
				.iter()
				.map(|n| match n {
					VfsNode::File { name, .. } | VfsNode::Directory { name, .. } => {
						name.as_str()
					}
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
		assert_eq!(result.root.size(), 100);

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

		let result = scan(
			&dir,
			ScanConfig {
				perf: true,
			},
		)
		.unwrap();
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
