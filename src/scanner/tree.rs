// Queries over a finished scan tree.
//
// The tree stays on the Rust side for the life of a scan instead of being
// handed to JS. A whole disk is millions of nodes: a lot of V8 heap (which
// Electron caps at 4 GB), and as one JSON document, longer than V8 allows a
// string to be. Nothing in the app needs all of it at once anyway. The
// renderer only ever sees a pruned slice around the current directory or a
// capped list of search hits, so those are cut here and only they cross
// into JS.

use crate::VfsNode;
use serde::Serialize;
use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;
use std::path::PathBuf;

// Entries smaller than this share of the current directory are left out of
// the sunburst, which couldn't draw them at a visible size anyway.
const SUNBURST_MIN_SHARE: f64 = 0.003;
// Rings the sunburst draws below its innermost one.
const SUNBURST_DEPTH: u32 = 6;
// Search hits that come back with paths; the rest are only counted.
const MATCH_CAP: usize = 500;

/// What the renderer needs to draw one directory. The main process adds the
/// drive glue (label, capacity) and the alphabetical tree view, which wants
/// locale-aware collation that JS already has.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSlice<'a> {
	/// The scan root's name, not the current directory's.
	pub name: &'a str,
	pub root_size: u64,
	/// Where the current directory starts, as a share of the root's size:
	/// everything ahead of it among its siblings, at every level of the
	/// cursor.
	pub position: f64,
	pub size: u64,
	/// Every child, in scan order (largest first), without their contents.
	pub list: Vec<Pruned<'a>>,
	/// The children large enough to draw, `SUNBURST_DEPTH` levels deep.
	pub sunburst: Vec<Pruned<'a>>,
}

/// A borrowed copy of a node, cut off below some depth. Serializes to the
/// same shape as `VfsNode`.
#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Pruned<'a> {
	Directory {
		name: &'a str,
		size: u64,
		mtime: u64,
		files: Vec<Pruned<'a>>,
	},
	File {
		name: &'a str,
		size: u64,
		mtime: u64,
	},
}

/// None if `cursor` doesn't lead to a directory.
pub fn render_slice<'a>(root: &'a VfsNode, cursor: &[String]) -> Option<RenderSlice<'a>> {
	let (dir, position) = walk_to_cursor(root, cursor)?;
	let VfsNode::Directory { size, files, .. } = dir else {
		return None;
	};
	let min_size = *size as f64 * SUNBURST_MIN_SHARE;
	Some(RenderSlice {
		name: root.name(),
		root_size: root.size(),
		position,
		size: *size,
		list: files.iter().map(|f| prune(f, 0, min_size)).collect(),
		sunburst: files
			.iter()
			.filter(|f| f.size() as f64 > min_size)
			.map(|f| prune(f, SUNBURST_DEPTH, min_size))
			.collect(),
	})
}

// Copies `node` and its descendants `depth` levels down, skipping any no
// larger than `min_size`. Directories at the cutoff come out empty.
fn prune(node: &VfsNode, depth: u32, min_size: f64) -> Pruned<'_> {
	match node {
		VfsNode::File { name, size, mtime } => Pruned::File {
			name,
			size: *size,
			mtime: *mtime,
		},
		VfsNode::Directory {
			name,
			size,
			mtime,
			files,
		} => Pruned::Directory {
			name,
			size: *size,
			mtime: *mtime,
			files: if depth == 0 {
				Vec::new()
			} else {
				files
					.iter()
					.filter(|f| f.size() as f64 > min_size)
					.map(|f| prune(f, depth - 1, min_size))
					.collect()
			},
		},
	}
}

// Follows `cursor` down from `root` to the directory it names, adding up the
// share of the root taken by the siblings ahead of it at each level.
fn walk_to_cursor<'a>(root: &'a VfsNode, cursor: &[String]) -> Option<(&'a VfsNode, f64)> {
	let scale = root.size() as f64;
	let mut position = 0.0;
	let mut current = root;
	for piece in cursor {
		let VfsNode::Directory { files, .. } = current else {
			return None;
		};
		let mut found = None;
		for file in files {
			if matches!(file, VfsNode::Directory { name, .. } if name == piece) {
				found = Some(file);
				break;
			}
			if scale > 0.0 {
				position += file.size() as f64 / scale;
			}
		}
		current = found?;
	}
	Some((current, position))
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SearchMatch {
	pub path: String,
	pub size: u64,
	#[serde(rename = "type")]
	pub kind: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
	/// The largest matches, largest first; ties keep scan order.
	pub matches: Vec<SearchMatch>,
	pub total_count: u64,
	pub total_size: u64,
	pub truncated: bool,
}

/// Every file and directory below `root` whose name contains `query`,
/// ignoring case. The search carries on inside matching directories. Only
/// the `MATCH_CAP` largest come back with paths, which start at `base_path`;
/// the rest are counted.
pub fn search(root: &VfsNode, base_path: &str, query: &str) -> SearchResults {
	let mut search = Search {
		needle: query.trim().to_lowercase(),
		base_path,
		stack: Vec::new(),
		top: BinaryHeap::new(),
		total_count: 0,
		total_size: 0,
	};
	if !search.needle.is_empty()
		&& let VfsNode::Directory { files, .. } = root
	{
		for child in files {
			search.visit(child);
		}
	}
	SearchResults {
		matches: search
			.top
			.into_sorted_vec()
			.into_iter()
			.map(|Reverse(hit)| hit.found)
			.collect(),
		truncated: search.total_count > MATCH_CAP as u64,
		total_count: search.total_count,
		total_size: search.total_size,
	}
}

struct Search<'a> {
	needle: String,
	base_path: &'a str,
	// Names from just below the root down to the node being visited.
	stack: Vec<&'a str>,
	// The best hits so far, worst on top so it's the one to evict.
	top: BinaryHeap<Reverse<Hit>>,
	total_count: u64,
	total_size: u64,
}

impl<'a> Search<'a> {
	fn visit(&mut self, node: &'a VfsNode) {
		self.stack.push(node.name());
		if contains_folded(node.name(), &self.needle) {
			self.total_count += 1;
			self.total_size += node.size();
			self.offer(node);
		}
		if let VfsNode::Directory { files, .. } = node {
			for child in files {
				self.visit(child);
			}
		}
		self.stack.pop();
	}

	// Keeps the hit if it's among the largest so far. The path is only
	// built once it's in, since most hits on a broad query aren't.
	fn offer(&mut self, node: &VfsNode) {
		let rank = (node.size(), Reverse(self.total_count));
		if self.top.len() == MATCH_CAP {
			match self.top.peek() {
				Some(Reverse(worst)) if rank > worst.rank => {
					self.top.pop();
				}
				_ => return,
			}
		}
		let mut path = PathBuf::from(self.base_path);
		for name in &self.stack {
			path.push(name);
		}
		self.top.push(Reverse(Hit {
			rank,
			found: SearchMatch {
				path: path.to_string_lossy().into_owned(),
				size: node.size(),
				kind: match node {
					VfsNode::Directory { .. } => "directory",
					VfsNode::File { .. } => "file",
				},
			},
		}));
	}
}

// Ordered by `rank` alone: size, then earlier in the scan.
struct Hit {
	rank: (u64, Reverse<u64>),
	found: SearchMatch,
}

impl Ord for Hit {
	fn cmp(&self, other: &Self) -> Ordering {
		self.rank.cmp(&other.rank)
	}
}

impl PartialOrd for Hit {
	fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
		Some(self.cmp(other))
	}
}

impl PartialEq for Hit {
	fn eq(&self, other: &Self) -> bool {
		self.rank == other.rank
	}
}

impl Eq for Hit {}

// Whether `name`, lowercased, contains `needle` (already lowercase). Most
// names are ASCII, and those are compared in place rather than lowercased
// into a new string per node.
fn contains_folded(name: &str, needle: &str) -> bool {
	if name.is_ascii() {
		let (name, needle) = (name.as_bytes(), needle.as_bytes());
		return name.len() >= needle.len()
			&& name
				.windows(needle.len())
				.any(|w| w.eq_ignore_ascii_case(needle));
	}
	name.to_lowercase().contains(needle)
}

/// Takes the entry at `parts` (names below the root) out of the tree and its
/// size off every directory above it. False if there's nothing there.
pub fn remove(root: &mut VfsNode, parts: &[String]) -> bool {
	match parts.split_last() {
		Some((last, dirs)) => remove_from(root, dirs, last).is_some(),
		None => false,
	}
}

// Returns the size removed.
fn remove_from(dir: &mut VfsNode, dirs: &[String], last: &str) -> Option<u64> {
	let VfsNode::Directory { size, files, .. } = dir else {
		return None;
	};
	let removed = match dirs.split_first() {
		Some((next, rest)) => {
			let child = files
				.iter_mut()
				.find(|f| matches!(f, VfsNode::Directory { name, .. } if name == next))?;
			remove_from(child, rest, last)?
		}
		None => {
			let index = files.iter().position(|f| f.name() == last)?;
			files.remove(index).size()
		}
	};
	*size = size.saturating_sub(removed);
	Some(removed)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn file(name: &str, size: u64) -> VfsNode {
		VfsNode::File {
			name: name.into(),
			size,
			mtime: 0,
		}
	}

	fn dir(name: &str, files: Vec<VfsNode>) -> VfsNode {
		VfsNode::Directory {
			name: name.into(),
			size: files.iter().map(VfsNode::size).sum(),
			mtime: 0,
			files,
		}
	}

	fn cursor(parts: &[&str]) -> Vec<String> {
		parts.iter().map(|p| p.to_string()).collect()
	}

	fn names<'a>(nodes: &'a [Pruned]) -> Vec<&'a str> {
		nodes
			.iter()
			.map(|n| match n {
				Pruned::Directory { name, .. } | Pruned::File { name, .. } => *name,
			})
			.collect()
	}

	#[test]
	fn no_slice_for_a_cursor_that_does_not_resolve() {
		let root = dir("root", vec![file("a.bin", 100)]);
		assert!(render_slice(&root, &cursor(&["nope"])).is_none());
		assert!(render_slice(&root, &cursor(&["a.bin"])).is_none());
	}

	#[test]
	fn sunburst_drops_entries_under_the_minimum_share() {
		// 0.3% of 10,000,100 bytes is ~30,000: the 100-byte file is under it.
		let root = dir(
			"root",
			vec![file("big.bin", 10_000_000), file("tiny.bin", 100)],
		);
		let slice = render_slice(&root, &[]).unwrap();
		assert_eq!(names(&slice.list), ["big.bin", "tiny.bin"]);
		assert_eq!(names(&slice.sunburst), ["big.bin"]);
	}

	#[test]
	fn sunburst_recurses_six_levels() {
		// root > d0 > d1 > … > d7 > leaf.bin
		let mut inner = dir("d7", vec![file("leaf.bin", 1_000_000)]);
		for i in (0..=6).rev() {
			inner = dir(&format!("d{i}"), vec![inner]);
		}
		let root = dir("root", vec![inner]);
		let slice = render_slice(&root, &[]).unwrap();

		// d0 is the innermost ring, and six more levels come with it: d6 is
		// the last, emitted without its contents.
		let mut node = &slice.sunburst[0];
		let mut depth = 0;
		while let Pruned::Directory { files, .. } = node {
			match files.first() {
				Some(child @ Pruned::Directory { .. }) => {
					node = child;
					depth += 1;
				}
				_ => break,
			}
		}
		assert_eq!(depth, 6);
		assert!(matches!(node, Pruned::Directory { name: "d6", files, .. } if files.is_empty()));
	}

	#[test]
	fn list_keeps_scan_order_and_drops_contents() {
		let root = dir(
			"root",
			vec![
				file("c.bin", 300),
				dir("a", vec![file("x", 200)]),
				file("b.bin", 100),
			],
		);
		let slice = render_slice(&root, &[]).unwrap();
		assert_eq!(names(&slice.list), ["c.bin", "a", "b.bin"]);
		assert!(matches!(&slice.list[1], Pruned::Directory { files, .. } if files.is_empty()));
	}

	#[test]
	fn cursor_descends_and_keeps_the_root_name() {
		let child = dir("child", vec![file("inside.bin", 5000)]);
		let root = dir("Macintosh HD", vec![child, file("sibling.bin", 5000)]);
		let slice = render_slice(&root, &cursor(&["child"])).unwrap();
		assert_eq!(slice.name, "Macintosh HD");
		assert_eq!(slice.root_size, 10_000);
		assert_eq!(slice.size, 5000);
		assert_eq!(names(&slice.list), ["inside.bin"]);
	}

	#[test]
	fn position_is_the_share_taken_by_preceding_siblings() {
		let root = dir(
			"root",
			vec![
				file("a.bin", 250),
				file("b.bin", 250),
				dir(
					"c",
					vec![file("inside.bin", 300), dir("d", vec![file("x", 200)])],
				),
			],
		);
		let position = |parts| render_slice(&root, &cursor(parts)).unwrap().position;
		assert!((position(&["c"]) - 0.5).abs() < 1e-12);
		assert!((position(&["c", "d"]) - 0.8).abs() < 1e-12);
	}

	#[test]
	fn empty_root_has_position_zero() {
		let root = dir("root", vec![file("a", 0), dir("b", vec![])]);
		assert_eq!(render_slice(&root, &cursor(&["b"])).unwrap().position, 0.0);
	}

	#[test]
	fn pruned_nodes_serialize_like_vfs_nodes() {
		let node = dir("d", vec![file("f", 10), dir("e", vec![file("g", 1)])]);
		assert_eq!(
			serde_json::to_value(prune(&node, 2, 0.0)).unwrap(),
			serde_json::to_value(&node).unwrap(),
		);
	}

	// A path as the search spells it, with the platform's separators.
	fn at(parts: &[&str]) -> String {
		parts
			.iter()
			.collect::<PathBuf>()
			.to_string_lossy()
			.into_owned()
	}

	fn search_tree() -> VfsNode {
		dir(
			"root",
			vec![
				dir(
					"Photos",
					vec![file("photo-1.jpg", 300), file("notes.txt", 5)],
				),
				file("PHOTO-2.JPG", 200),
				dir("other", vec![file("Ünïcode Photo.png", 100)]),
			],
		)
	}

	#[test]
	fn search_matches_names_ignoring_case_inside_matching_directories() {
		let results = search(&search_tree(), "/base", "  photo ");
		let paths: Vec<_> = results.matches.iter().map(|m| m.path.as_str()).collect();
		assert_eq!(
			paths,
			[
				at(&["/base", "Photos"]),
				at(&["/base", "Photos", "photo-1.jpg"]),
				at(&["/base", "PHOTO-2.JPG"]),
				at(&["/base", "other", "Ünïcode Photo.png"]),
			]
		);
		assert_eq!(results.matches[0].kind, "directory");
		assert_eq!(results.matches[1].kind, "file");
		assert_eq!(results.total_count, 4);
		assert_eq!(results.total_size, 305 + 300 + 200 + 100);
		assert!(!results.truncated);
	}

	#[test]
	fn search_folds_case_in_non_ascii_names() {
		let results = search(&search_tree(), "/", "ÜNÏ");
		assert_eq!(
			results.matches[0].path,
			at(&["/", "other", "Ünïcode Photo.png"])
		);
	}

	#[test]
	fn empty_search_matches_nothing() {
		let results = search(&search_tree(), "/", "   ");
		assert!(results.matches.is_empty());
		assert_eq!(results.total_count, 0);
	}

	#[test]
	fn search_keeps_the_largest_matches_and_counts_the_rest() {
		let files = (1..=600).map(|i| file(&format!("f{i}"), i)).collect();
		let results = search(&dir("root", files), "/", "f");
		assert_eq!(results.matches.len(), MATCH_CAP);
		assert!(results.truncated);
		assert_eq!(results.total_count, 600);
		assert_eq!(results.total_size, (1..=600).sum::<u64>());
		assert_eq!(results.matches.first().unwrap().size, 600);
		assert_eq!(results.matches.last().unwrap().size, 101);
	}

	#[test]
	fn search_ties_keep_scan_order() {
		let files = (0..MATCH_CAP + 10)
			.map(|i| file(&format!("f{i}"), 7))
			.collect();
		let results = search(&dir("root", files), "/", "f");
		assert_eq!(results.matches[0].path, "/f0");
		assert_eq!(
			results.matches.last().unwrap().path,
			format!("/f{}", MATCH_CAP - 1)
		);
	}

	#[test]
	fn remove_takes_the_size_off_every_ancestor() {
		let mut root = dir(
			"root",
			vec![
				dir("a", vec![dir("b", vec![file("x", 30), file("y", 70)])]),
				file("z", 5),
			],
		);
		assert!(remove(&mut root, &cursor(&["a", "b", "x"])));
		assert_eq!(root.size(), 75);
		let slice = render_slice(&root, &cursor(&["a", "b"])).unwrap();
		assert_eq!(slice.size, 70);
		assert_eq!(names(&slice.list), ["y"]);
		assert_eq!(render_slice(&root, &cursor(&["a"])).unwrap().size, 70);
	}

	#[test]
	fn remove_reports_missing_entries_and_leaves_the_tree_alone() {
		let mut root = dir("root", vec![dir("a", vec![file("x", 30)])]);
		assert!(!remove(&mut root, &cursor(&["a", "nope"])));
		assert!(!remove(&mut root, &cursor(&["nope", "x"])));
		assert!(!remove(&mut root, &cursor(&["a", "x", "deeper"])));
		assert!(!remove(&mut root, &[]));
		assert_eq!(root.size(), 30);
	}
}
