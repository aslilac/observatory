use super::Sweep;
use super::geometry::is_drawable;
use crate::color::{Color, Kind, hue_for_range, sunburst_color};
use crate::paths::join_path;
use crate::reserved::ReservedGroup;
use crate::tree::{Item, Node};
use std::sync::Arc;

const MAX_LAYER: usize = 6;

#[derive(Debug, Clone, PartialEq)]
pub struct Wedge {
	// The same wherever the sunburst is centered, so a wedge can be followed
	// from one folder's view to the next.
	pub key: String,
	pub sweep: Sweep,
	// Absolute depth below the scan root, for color.
	pub depth: usize,
	pub kind: Kind,
	pub fill: Color,
	pub node: Arc<Node>,
	// Below the current folder, what clicking the wedge opens.
	pub path: Vec<String>,
	// Set when it's a file or folder's own wedge, rather than reserved space
	// or the rest of a folder: what its menu and dragging it act on.
	pub item: Option<Item>,
	// Set when it's one of the reserved wedges, which `node` only names.
	pub reserved: Option<ReservedGroup>,
	// Faded when this is in cleanup, or inside something that is.
	pub cleanup_path: Option<String>,
}

/// The key of the wedge for whatever is at `names` below the scan `root`.
pub fn wedge_key<S: AsRef<str>>(root: &str, names: impl IntoIterator<Item = S>) -> String {
	let mut key = root.to_string();
	for name in names {
		key.push('\0');
		key.push_str(name.as_ref());
	}
	key
}

pub struct LayoutInput<'a> {
	pub root: &'a str,
	pub cursor: &'a [String],
	pub files: &'a [Arc<Node>],
	// What a full turn stands for: the folder's size, or the disk's capacity
	// at the root of a whole-disk scan.
	pub capacity: u64,
	pub size: u64,
	pub root_size: u64,
	// Where the folder starts, as a share of the root's size (see
	// `RenderTree::position`). Only the colors use it.
	pub position: f64,
	pub reserved: &'a [ReservedGroup],
	pub dark: bool,
}

/// Every wedge the sunburst draws for the folder at `cursor`.
pub fn layout_wedges(input: &LayoutInput) -> Vec<Wedge> {
	let mut wedges = Vec::new();
	if input.capacity == 0 || input.root_size == 0 {
		return wedges;
	}
	let capacity = input.capacity as f64;
	let base_path = join_path(input.root, input.cursor);
	layout_ring(
		input,
		&base_path,
		&mut wedges,
		input.files,
		0,
		0.0,
		input.position,
		&[],
	);

	let mut reserved_pos = input.size as f64 / capacity;
	for group in input.reserved {
		// Kept inside the circle should the capacity be unknown.
		let share = (group.size as f64 / capacity).min(1.0 - reserved_pos);
		if is_drawable(share, 0) {
			wedges.push(Wedge {
				key: format!(
					"{}\0reserved\0{:?}",
					wedge_key::<&str>(input.root, []),
					group.kind
				),
				sweep: Sweep {
					x0: reserved_pos,
					x1: reserved_pos + share,
					layer: 0.0,
				},
				depth: input.cursor.len(),
				kind: Kind::Reserved,
				fill: sunburst_color(0.0, input.cursor.len(), Kind::Reserved, input.dark),
				node: Arc::new(Node::file(group.label, group.size, 0)),
				path: Vec::new(),
				item: None,
				reserved: Some(group.clone()),
				cleanup_path: None,
			});
		}
		reserved_pos += share;
	}
	wedges
}

#[allow(clippy::too_many_arguments)]
fn layout_ring(
	input: &LayoutInput,
	base_path: &str,
	wedges: &mut Vec<Wedge>,
	nodes: &[Arc<Node>],
	layer: usize,
	start_pos: f64,
	// Where this run of siblings starts in hue space, as a fraction of the
	// root's size. Tracked separately from start_pos because the arc geometry
	// is scaled to the current directory's capacity while hues stay anchored
	// to the scan root.
	hue_start: f64,
	parent_path: &[String],
) {
	let capacity = input.capacity as f64;
	let root_size = input.root_size as f64;
	let depth = input.cursor.len() + layer;
	let mut pos = start_pos;
	let mut hue_pos = hue_start;
	for node in nodes {
		let slice_size = node.size as f64 / capacity;
		let hue_size = node.size as f64 / root_size;
		// Hues follow every sibling's bytes, drawn or not, to match the legend.
		let node_hue_pos = hue_pos;
		hue_pos += hue_size;
		if !is_drawable(slice_size, layer) {
			continue;
		}
		let hue = hue_for_range(node_hue_pos, hue_size);
		let mut path = parent_path.to_vec();
		path.push(node.name.clone());
		let key = wedge_key(input.root, input.cursor.iter().chain(&path));
		let full_path = join_path(base_path, &path);
		let kind = if node.directory {
			Kind::Directory
		} else {
			Kind::File
		};

		wedges.push(Wedge {
			key: key.clone(),
			sweep: Sweep {
				x0: pos,
				x1: pos + slice_size,
				layer: layer as f64,
			},
			depth,
			kind,
			fill: sunburst_color(hue, depth, kind, input.dark),
			node: node.clone(),
			path: path.clone(),
			item: Some(Item {
				path: full_path.clone(),
				name: node.name.clone(),
				size: node.size,
				directory: node.directory,
			}),
			cleanup_path: Some(full_path.clone()),
			reserved: None,
		});

		if node.directory && layer < MAX_LAYER {
			if !node.files.is_empty() {
				layout_ring(
					input,
					base_path,
					wedges,
					&node.files,
					layer + 1,
					pos,
					node_hue_pos,
					&path,
				);
			}

			// The rest of the directory goes in one gray wedge: children too
			// small to draw, whether they were dropped here or by the scanner
			// (src/scanner/tree.rs), which leaves no trace of them.
			let children_sum: f64 = node
				.files
				.iter()
				.map(|f| f.size as f64 / capacity)
				.filter(|s| is_drawable(*s, layer + 1))
				.sum();
			let remainder = slice_size - children_sum;
			if layer < 4 && is_drawable(remainder, layer + 1) {
				wedges.push(Wedge {
					key: format!("{key}\0rest"),
					sweep: Sweep {
						x0: pos + children_sum,
						x1: pos + slice_size,
						layer: (layer + 1) as f64,
					},
					depth: depth + 1,
					kind: Kind::Imaginary,
					fill: sunburst_color(hue, depth + 1, Kind::Imaginary, input.dark),
					node: node.clone(),
					path,
					item: None,
					reserved: None,
					cleanup_path: Some(full_path),
				});
			}
		}

		pos += slice_size;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn input<'a>(files: &'a [Arc<Node>], cursor: &'a [String]) -> LayoutInput<'a> {
		LayoutInput {
			root: "/disk",
			cursor,
			files,
			capacity: 100,
			size: 100,
			root_size: 100,
			position: 0.0,
			reserved: &[],
			dark: false,
		}
	}

	#[test]
	fn wedges_follow_sizes_and_nest() {
		let files = [
			Arc::new(Node::directory(
				"a",
				60,
				0,
				vec![
					Arc::new(Node::file("big", 40, 0)),
					// The rest of `a` was too small for the scanner to keep.
				],
			)),
			Arc::new(Node::file("b", 40, 0)),
		];
		let wedges = layout_wedges(&input(&files, &[]));
		let keys: Vec<_> = wedges.iter().map(|w| w.key.replace('\0', "/")).collect();
		assert_eq!(keys, ["/disk/a", "/disk/a/big", "/disk/a/rest", "/disk/b"]);

		let a = &wedges[0];
		assert_eq!(
			a.sweep,
			Sweep {
				x0: 0.0,
				x1: 0.6,
				layer: 0.0
			}
		);
		assert_eq!(a.item.as_ref().unwrap().path, "/disk/a");
		let big = &wedges[1];
		assert_eq!(
			big.sweep,
			Sweep {
				x0: 0.0,
				x1: 0.4,
				layer: 1.0
			}
		);
		assert_eq!(big.path, ["a", "big"]);
		let rest = &wedges[2];
		assert_eq!(rest.kind, Kind::Imaginary);
		assert_eq!((rest.sweep.x0, rest.sweep.layer), (0.4, 1.0));
		assert!(rest.item.is_none());
		assert_eq!(rest.cleanup_path.as_deref(), Some("/disk/a"));
		assert_eq!(wedges[3].sweep.x0, 0.6);
	}

	#[test]
	fn slivers_are_left_out_but_keep_their_place() {
		let files = [
			Arc::new(Node::file("sliver", 1, 0)),
			Arc::new(Node::file("b", 9999, 0)),
		];
		let wedges = layout_wedges(&LayoutInput {
			capacity: 10_000,
			size: 10_000,
			root_size: 10_000,
			..input(&files, &[])
		});
		assert_eq!(wedges.len(), 1);
		// Not drawn, so the next wedge starts where it would have.
		assert_eq!(wedges[0].sweep.x0, 0.0);
	}

	#[test]
	fn reserved_space_follows_the_files() {
		let files = [Arc::new(Node::file("a", 50, 0))];
		let reserved = [ReservedGroup {
			kind: observatory_scan::reserved::ReservedKind::Paging,
			label: "virtual memory",
			hint: "",
			names: vec!["pagefile.sys".to_string()],
			size: 20,
		}];
		let wedges = layout_wedges(&LayoutInput {
			size: 50,
			reserved: &reserved,
			..input(&files, &[])
		});
		assert_eq!(wedges.len(), 2);
		assert_eq!(wedges[1].kind, Kind::Reserved);
		assert_eq!(
			wedges[1].sweep,
			Sweep {
				x0: 0.5,
				x1: 0.7,
				layer: 0.0
			}
		);
		assert_eq!(wedges[1].node.name, "virtual memory");
	}

	#[test]
	fn keys_are_the_same_from_any_folder() {
		let inner = Arc::new(Node::file("big", 40, 0));
		let files = [Arc::new(Node::directory("a", 40, 0, vec![inner.clone()]))];
		let from_root = layout_wedges(&input(&files, &[]));
		let cursor = ["a".to_string()];
		let inside = [inner];
		let from_a = layout_wedges(&LayoutInput {
			capacity: 40,
			size: 40,
			..input(&inside, &cursor)
		});
		assert_eq!(from_root[1].key, from_a[0].key);
		// And so is the color.
		assert_eq!(from_root[1].fill, from_a[0].fill);
	}
}
