// What a view draws of one directory of a finished scan.
//
// The scan's own tree stays where the scanner built it, behind the scan's
// handle (see scans.rs): a whole disk is millions of nodes. A view only ever
// holds a slice cut around the folder it's showing, which is what's here.

use crate::scans::ScanDrive;
use observatory_scan::Reserved;
use observatory_scan::tree::{Pruned, RenderSlice};
use std::sync::Arc;

/// A file or folder in a slice. A folder's `files` only go as deep as the
/// slice was cut.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
	pub name: String,
	pub size: u64,
	// Latest mtime among this and everything in it, in milliseconds since
	// 1970.
	pub mtime: u64,
	pub directory: bool,
	pub files: Vec<Arc<Node>>,
}

impl Node {
	pub fn file(name: &str, size: u64, mtime: u64) -> Self {
		Self {
			name: name.to_string(),
			size,
			mtime,
			directory: false,
			files: Vec::new(),
		}
	}

	pub fn directory(name: &str, size: u64, mtime: u64, files: Vec<Arc<Node>>) -> Self {
		Self {
			name: name.to_string(),
			size,
			mtime,
			directory: true,
			files,
		}
	}
}

impl From<&Pruned<'_>> for Node {
	fn from(pruned: &Pruned<'_>) -> Self {
		match pruned {
			Pruned::Directory {
				name,
				size,
				mtime,
				files,
			} => Node::directory(
				name,
				*size,
				*mtime,
				files.iter().map(|f| Arc::new(f.into())).collect(),
			),
			Pruned::File { name, size, mtime } => Node::file(name, *size, *mtime),
		}
	}
}

/// A file or folder as something to act on (select, reveal, move to
/// cleanup): where it is, and what the lists say of it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Item {
	pub path: String,
	pub name: String,
	pub size: u64,
	pub directory: bool,
}

// Three views of the same directory:
//   list      all immediate children, in scan order (largest first)
//   sunburst  without anything under 0.3% of the directory, 6 levels deep
//   tree      the immediate children by name (the folder tree asks for
//             deeper levels as they're opened)
#[derive(Debug, Clone, PartialEq)]
pub struct RenderTree {
	/// The scan root's name, or the drive's for a scan of a whole disk.
	pub name: String,
	pub cursor: Vec<String>,
	pub root_capacity: u64,
	pub root_size: u64,
	/// What a full turn of the sunburst stands for: the folder's size, or
	/// the disk's capacity at the root of a whole-disk scan.
	pub capacity: u64,
	/// Where this directory starts, as a share of the root's size.
	pub position: f64,
	pub size: u64,
	pub list: Vec<Arc<Node>>,
	pub sunburst: Vec<Arc<Node>>,
	pub tree: Vec<Arc<Node>>,
	/// At the root of a scan of a whole Windows disk, what Windows keeps for
	/// itself, which isn't in `size`. Empty anywhere else.
	pub reserved: Vec<Reserved>,
}

// Turns the scanner's slice of a directory into what a view draws. The
// pruning already happened next to the tree (src/scanner/tree.rs); what's
// left is the drive glue, and the folder tree's alphabetical order.
pub fn assemble(
	slice: &RenderSlice<'_>,
	cursor: &[String],
	drive: Option<&ScanDrive>,
	reserved: &[Reserved],
) -> RenderTree {
	let capacity = drive.and_then(|d| d.capacity).filter(|c| *c > 0);
	let list: Vec<Arc<Node>> = slice.list.iter().map(|f| Arc::new(f.into())).collect();
	let mut tree = list.clone();
	tree.sort_by_cached_key(|node| (node.name.to_lowercase(), node.name.clone()));
	RenderTree {
		name: drive.map_or(slice.name, |d| &d.name).to_string(),
		cursor: cursor.to_vec(),
		root_capacity: capacity.unwrap_or(slice.root_size),
		root_size: slice.root_size,
		// Only the root has a capacity of its own: the drive's.
		capacity: capacity
			.filter(|_| cursor.is_empty())
			.unwrap_or(slice.size),
		position: slice.position,
		size: slice.size,
		list,
		sunburst: slice.sunburst.iter().map(|f| Arc::new(f.into())).collect(),
		tree,
		reserved: if cursor.is_empty() {
			reserved.to_vec()
		} else {
			Vec::new()
		},
	}
}
