// Synchronous parallel filesystem scanner.
//
// The recursion is driven by rayon's work-stealing pool: each directory does
// one (sequential) readdir to enumerate its children, then fans out the per-
// entry metadata lookups and subdirectory recursion through a parallel
// iterator. No async, no tokio, no Pin / Send puzzles — `read_dir` and
// `metadata` are themselves blocking syscalls that don't have meaningful
// async equivalents on Linux or macOS, so we just lean into threads.
//
// Output shape mirrors `Ob.VfsDirectory` from the TS side so a future
// napi-rs binding (or a child-process JSON bridge) can hand the tree
// straight to the renderer.

use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

#[derive(Default)]
pub struct Counts {
	pub files: AtomicU64,
	pub directories: AtomicU64,
	pub symlinks: AtomicU64,
	pub devices: AtomicU64,
	pub misc: AtomicU64,
	pub errors: AtomicU64,
}

impl Counts {
	pub fn snapshot(&self) -> CountsSnapshot {
		CountsSnapshot {
			files: self.files.load(Ordering::Relaxed),
			directories: self.directories.load(Ordering::Relaxed),
			symlinks: self.symlinks.load(Ordering::Relaxed),
			devices: self.devices.load(Ordering::Relaxed),
			misc: self.misc.load(Ordering::Relaxed),
			errors: self.errors.load(Ordering::Relaxed),
		}
	}
}

#[derive(Debug, Clone, Copy)]
pub struct CountsSnapshot {
	pub files: u64,
	pub directories: u64,
	pub symlinks: u64,
	pub devices: u64,
	pub misc: u64,
	pub errors: u64,
}

impl CountsSnapshot {
	pub fn total_entries(&self) -> u64 {
		self.files + self.directories + self.symlinks + self.devices + self.misc
	}
}

#[derive(Serialize)]
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

pub struct ScanResult {
	pub root: VfsNode,
	pub counts: CountsSnapshot,
}

pub fn scan(path: &Path) -> std::io::Result<ScanResult> {
	let counts = Counts::default();
	let root = scan_dir(path, &counts);
	Ok(ScanResult {
		root,
		counts: counts.snapshot(),
	})
}

fn scan_dir(path: &Path, counts: &Counts) -> VfsNode {
	let name = path
		.file_name()
		.map(|n| n.to_string_lossy().into_owned())
		.unwrap_or_else(|| path.to_string_lossy().into_owned());

	// One sequential readdir per directory — the parallelism happens across
	// entries (statting them and recursing into subdirs).
	let entries: Vec<_> = match fs::read_dir(path) {
		Ok(rd) => rd.filter_map(Result::ok).collect(),
		Err(_) => {
			counts.errors.fetch_add(1, Ordering::Relaxed);
			return VfsNode::Directory {
				name,
				size: 0,
				mtime: 0,
				files: vec![],
			};
		}
	};

	let mut children: Vec<VfsNode> = entries
		.into_par_iter()
		.filter_map(|entry| classify(entry, counts))
		.collect();

	children.sort_by(|a, b| b.size().cmp(&a.size()));
	let size = children.iter().map(|n| n.size()).sum();
	let mtime = children.iter().map(|n| n.mtime()).max().unwrap_or(0);

	VfsNode::Directory {
		name,
		size,
		mtime,
		files: children,
	}
}

// `DirEntry::metadata` does not follow symlinks (matches lstat), which is
// what the JS scanner uses.
fn classify(entry: fs::DirEntry, counts: &Counts) -> Option<VfsNode> {
	let meta = match entry.metadata() {
		Ok(m) => m,
		Err(_) => {
			counts.errors.fetch_add(1, Ordering::Relaxed);
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
		counts.files.fetch_add(1, Ordering::Relaxed);
		Some(VfsNode::File {
			name: entry_name,
			size: meta.len(),
			mtime,
		})
	} else if ft.is_dir() {
		counts.directories.fetch_add(1, Ordering::Relaxed);
		Some(scan_dir(&entry.path(), counts))
			.map(|node| rename(node, entry_name))
	} else if ft.is_symlink() {
		counts.symlinks.fetch_add(1, Ordering::Relaxed);
		None
	} else {
		counts.misc.fetch_add(1, Ordering::Relaxed);
		None
	}
}

// scan_dir uses `path.file_name()` for the directory name, which is fine for
// the root but loses information for entries we've already enumerated (we
// already know the name from the parent's DirEntry). This helper rewrites the
// name field so the parent's stringified entry name wins.
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

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs::{self, File};
	use std::io::Write;

	fn tmpdir(suffix: &str) -> std::path::PathBuf {
		let dir = std::env::temp_dir().join(format!(
			"observatory-scan-test-{}-{}",
			std::process::id(),
			suffix,
		));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).unwrap();
		dir
	}

	fn write(path: &Path, bytes: usize) {
		let mut f = File::create(path).unwrap();
		f.write_all(&vec![0u8; bytes]).unwrap();
	}

	#[test]
	fn scans_a_flat_directory() {
		let dir = tmpdir("flat");
		write(&dir.join("a.bin"), 100);
		write(&dir.join("b.bin"), 200);

		let result = scan(&dir).unwrap();
		assert_eq!(result.counts.files, 2);
		assert_eq!(result.counts.directories, 0);
		assert_eq!(result.root.size(), 300);

		fs::remove_dir_all(&dir).unwrap();
	}

	#[test]
	fn recurses_and_sums_subdirectories() {
		let dir = tmpdir("nested");
		let sub = dir.join("sub");
		fs::create_dir(&sub).unwrap();
		write(&sub.join("deep.bin"), 500);
		write(&dir.join("top.bin"), 100);

		let result = scan(&dir).unwrap();
		assert_eq!(result.counts.files, 2);
		assert_eq!(result.counts.directories, 1);
		assert_eq!(result.root.size(), 600);

		fs::remove_dir_all(&dir).unwrap();
	}

	#[test]
	fn sorts_children_size_descending() {
		let dir = tmpdir("sorted");
		write(&dir.join("small.bin"), 10);
		write(&dir.join("big.bin"), 1000);
		write(&dir.join("mid.bin"), 100);

		let result = scan(&dir).unwrap();
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

		fs::remove_dir_all(&dir).unwrap();
	}

	#[test]
	fn counts_symlinks_but_skips_them() {
		let dir = tmpdir("links");
		write(&dir.join("real.bin"), 100);
		std::os::unix::fs::symlink(dir.join("real.bin"), dir.join("link.bin")).unwrap();

		let result = scan(&dir).unwrap();
		assert_eq!(result.counts.symlinks, 1);
		assert_eq!(result.counts.files, 1);
		assert_eq!(result.root.size(), 100);

		fs::remove_dir_all(&dir).unwrap();
	}
}
