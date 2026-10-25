// Queries over a finished scan tree.
//
// The tree stays on the Rust side for the life of a scan instead of being
// handed to JS. A whole disk is millions of nodes: a lot of V8 heap (which
// Electron caps at 4 GB), and as one JSON document, longer than V8 allows a
// string to be. Nothing in the app needs all of it at once anyway. The
// renderer only ever sees a pruned slice around the current directory (or
// a capped list of what find.rs finds), so those are cut here and only they
// cross into JS.

use crate::{Name, Tree, VfsNode};
use serde::Serialize;

// Entries smaller than this share of the current directory are left out of
// the sunburst, which couldn't draw them at a visible size anyway.
const SUNBURST_MIN_SHARE: f64 = 0.003;
// Rings the sunburst draws below its innermost one.
const SUNBURST_DEPTH: u32 = 6;

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
/// same shape as a `Tree`.
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
pub fn render_slice<'a>(tree: &'a Tree, cursor: &[String]) -> Option<RenderSlice<'a>> {
	let (dir, position) = walk_to_cursor(tree, cursor)?;
	let VfsNode::Directory { size, files, .. } = dir else {
		return None;
	};
	let min_size = *size as f64 * SUNBURST_MIN_SHARE;
	Some(RenderSlice {
		name: tree.name(&tree.root),
		root_size: tree.root.size(),
		position,
		size: *size,
		list: files.iter().map(|f| prune(tree, f, 0, min_size)).collect(),
		sunburst: files
			.iter()
			.filter(|f| f.size() as f64 > min_size)
			.map(|f| prune(tree, f, SUNBURST_DEPTH, min_size))
			.collect(),
	})
}

// Copies `node` (in `tree`) and its descendants `depth` levels down, skipping
// any no larger than `min_size`. Directories at the cutoff come out empty.
fn prune<'a>(tree: &'a Tree, node: &'a VfsNode, depth: u32, min_size: f64) -> Pruned<'a> {
	let name = tree.name(node);
	let mtime = node.mtime_ms();
	match node {
		VfsNode::File { size, .. } => Pruned::File {
			name,
			size: *size,
			mtime,
		},
		VfsNode::Directory { size, files, .. } => Pruned::Directory {
			name,
			size: *size,
			mtime,
			files: if depth == 0 {
				Vec::new()
			} else {
				files
					.iter()
					.filter(|f| f.size() as f64 > min_size)
					.map(|f| prune(tree, f, depth - 1, min_size))
					.collect()
			},
		},
	}
}

// Follows `cursor` down from the root to the directory it names, adding up
// the share of the root taken by the siblings ahead of it at each level.
pub(crate) fn walk_to_cursor<'a>(tree: &'a Tree, cursor: &[String]) -> Option<(&'a VfsNode, f64)> {
	let scale = tree.root.size() as f64;
	let mut position = 0.0;
	let mut current = &tree.root;
	for piece in cursor {
		let VfsNode::Directory { files, .. } = current else {
			return None;
		};
		// No node has a name the tree doesn't.
		let piece = tree.names.get(piece)?;
		let mut found = None;
		for file in files {
			if matches!(file, VfsNode::Directory { name, .. } if *name == piece) {
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

/// Takes the entry at `parts` (names below the root) out of the tree and its
/// size off every directory above it. False if there's nothing there.
pub fn remove(tree: &mut Tree, parts: &[String]) -> bool {
	// No node has a name the tree doesn't.
	let Some(parts) = parts
		.iter()
		.map(|part| tree.names.get(part))
		.collect::<Option<Vec<_>>>()
	else {
		return false;
	};
	match parts.split_last() {
		Some((&last, dirs)) => remove_from(&mut tree.root, dirs, last).is_some(),
		None => false,
	}
}

// Returns the size removed.
fn remove_from(dir: &mut VfsNode, dirs: &[Name], last: Name) -> Option<u64> {
	let VfsNode::Directory { size, files, .. } = dir else {
		return None;
	};
	let removed = match dirs.split_first() {
		Some((&next, rest)) => {
			let child = files
				.iter_mut()
				.find(|f| matches!(f, VfsNode::Directory { name, .. } if *name == next))?;
			remove_from(child, rest, last)?
		}
		None => {
			let index = files.iter().position(|f| f.name() == last)?;
			let mut rest = std::mem::take(files).into_vec();
			let removed = rest.remove(index);
			*files = rest.into_boxed_slice();
			removed.size()
		}
	};
	*size = size.saturating_sub(removed);
	Some(removed)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::JsonNode;

	fn file(name: &str, size: u64) -> JsonNode {
		JsonNode::File {
			name: name.into(),
			size,
			mtime: 0,
		}
	}

	fn dir(name: &str, files: Vec<JsonNode>) -> JsonNode {
		JsonNode::Directory {
			name: name.into(),
			size: files
				.iter()
				.map(|f| match f {
					JsonNode::Directory { size, .. } | JsonNode::File { size, .. } => size,
				})
				.sum(),
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
		let tree = Tree::from(dir("root", vec![file("a.bin", 100)]));
		assert!(render_slice(&tree, &cursor(&["nope"])).is_none());
		assert!(render_slice(&tree, &cursor(&["a.bin"])).is_none());
	}

	#[test]
	fn sunburst_drops_entries_under_the_minimum_share() {
		// 0.3% of 10,000,100 bytes is ~30,000: the 100-byte file is under it.
		let tree = Tree::from(dir(
			"root",
			vec![file("big.bin", 10_000_000), file("tiny.bin", 100)],
		));
		let slice = render_slice(&tree, &[]).unwrap();
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
		let tree = Tree::from(dir("root", vec![inner]));
		let slice = render_slice(&tree, &[]).unwrap();

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
		let tree = Tree::from(dir(
			"root",
			vec![
				file("c.bin", 300),
				dir("a", vec![file("x", 200)]),
				file("b.bin", 100),
			],
		));
		let slice = render_slice(&tree, &[]).unwrap();
		assert_eq!(names(&slice.list), ["c.bin", "a", "b.bin"]);
		assert!(matches!(&slice.list[1], Pruned::Directory { files, .. } if files.is_empty()));
	}

	#[test]
	fn cursor_descends_and_keeps_the_root_name() {
		let child = dir("child", vec![file("inside.bin", 5000)]);
		let tree = Tree::from(dir("Macintosh HD", vec![child, file("sibling.bin", 5000)]));
		let slice = render_slice(&tree, &cursor(&["child"])).unwrap();
		assert_eq!(slice.name, "Macintosh HD");
		assert_eq!(slice.root_size, 10_000);
		assert_eq!(slice.size, 5000);
		assert_eq!(names(&slice.list), ["inside.bin"]);
	}

	#[test]
	fn position_is_the_share_taken_by_preceding_siblings() {
		let tree = Tree::from(dir(
			"root",
			vec![
				file("a.bin", 250),
				file("b.bin", 250),
				dir(
					"c",
					vec![file("inside.bin", 300), dir("d", vec![file("x", 200)])],
				),
			],
		));
		let position = |parts| render_slice(&tree, &cursor(parts)).unwrap().position;
		assert!((position(&["c"]) - 0.5).abs() < 1e-12);
		assert!((position(&["c", "d"]) - 0.8).abs() < 1e-12);
	}

	#[test]
	fn empty_root_has_position_zero() {
		let tree = Tree::from(dir("root", vec![file("a", 0), dir("b", vec![])]));
		assert_eq!(render_slice(&tree, &cursor(&["b"])).unwrap().position, 0.0);
	}

	#[test]
	fn pruned_nodes_serialize_like_vfs_nodes() {
		let tree = Tree::from(dir("d", vec![file("f", 10), dir("e", vec![file("g", 1)])]));
		assert_eq!(
			serde_json::to_value(prune(&tree, &tree.root, 2, 0.0)).unwrap(),
			serde_json::to_value(&tree).unwrap(),
		);
	}

	#[test]
	fn remove_takes_the_size_off_every_ancestor() {
		let mut tree = Tree::from(dir(
			"root",
			vec![
				dir("a", vec![dir("b", vec![file("x", 30), file("y", 70)])]),
				file("z", 5),
			],
		));
		assert!(remove(&mut tree, &cursor(&["a", "b", "x"])));
		assert_eq!(tree.root.size(), 75);
		let slice = render_slice(&tree, &cursor(&["a", "b"])).unwrap();
		assert_eq!(slice.size, 70);
		assert_eq!(names(&slice.list), ["y"]);
		assert_eq!(render_slice(&tree, &cursor(&["a"])).unwrap().size, 70);
	}

	#[test]
	fn remove_reports_missing_entries_and_leaves_the_tree_alone() {
		let mut tree = Tree::from(dir("root", vec![dir("a", vec![file("x", 30)])]));
		assert!(!remove(&mut tree, &cursor(&["a", "nope"])));
		assert!(!remove(&mut tree, &cursor(&["nope", "x"])));
		assert!(!remove(&mut tree, &cursor(&["a", "x", "deeper"])));
		assert!(!remove(&mut tree, &[]));
		assert_eq!(tree.root.size(), 30);
	}
}
