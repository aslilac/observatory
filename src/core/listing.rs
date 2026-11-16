// The list beside the sunburst: a folder's children in the order the user
// asked for, short of what's too small to matter until they ask for it all.

use crate::tree::Node;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SortMode {
	#[default]
	Size,
	Name,
	Newest,
	Oldest,
}

impl SortMode {
	pub const ALL: [SortMode; 4] = [
		SortMode::Size,
		SortMode::Name,
		SortMode::Newest,
		SortMode::Oldest,
	];

	pub fn label(self) -> &'static str {
		match self {
			SortMode::Size => "Size",
			SortMode::Name => "Name",
			SortMode::Newest => "Newest",
			SortMode::Oldest => "Oldest",
		}
	}

	/// Whether rows say when they last changed, since that's the order.
	pub fn shows_dates(self) -> bool {
		matches!(self, SortMode::Newest | SortMode::Oldest)
	}
}

/// How many rows a list by size starts with.
pub const TOP_N: usize = 10;

pub struct Listing {
	pub visible: Vec<Arc<Node>>,
	/// How many there are in all; more than `visible` when some are held
	/// back.
	pub total: usize,
}

/// `files` (a slice's `list`: largest first) as `mode` orders them. Unless
/// `show_all`, empty things and things under a thousandth of the largest
/// are left out, as noise next to what's taking up the space, and a list by
/// size stops at `TOP_N`.
pub fn listing(files: &[Arc<Node>], mode: SortMode, show_all: bool) -> Listing {
	let mut sorted = files.to_vec();
	match mode {
		// Already in order, from the scanner.
		SortMode::Size => {}
		SortMode::Name => {
			sorted.sort_by_cached_key(|file| (file.name.to_lowercase(), file.name.clone()))
		}
		SortMode::Newest => sorted.sort_by_key(|file| std::cmp::Reverse(file.mtime)),
		SortMode::Oldest => sorted.sort_by_key(|file| file.mtime),
	}
	let total = sorted.len();
	if !show_all {
		let largest = files.iter().map(|file| file.size).max().unwrap_or(0);
		sorted.retain(|file| file.size > 0 && file.size.saturating_mul(1000) >= largest);
		if mode == SortMode::Size {
			sorted.truncate(TOP_N);
		}
	}
	Listing {
		visible: sorted,
		total,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn files() -> Vec<Arc<Node>> {
		let mut files: Vec<_> = (1..=15u64)
			.map(|i| Arc::new(Node::file(&format!("f{i:02}"), i * 1000, 100 - i)))
			.collect();
		files.push(Arc::new(Node::file("empty", 0, 500)));
		files.push(Arc::new(Node::file("speck", 1, 600)));
		files.sort_by_key(|file| std::cmp::Reverse(file.size));
		files
	}

	#[test]
	fn by_size_is_the_top_ten() {
		let list = listing(&files(), SortMode::Size, false);
		assert_eq!(list.visible.len(), TOP_N);
		assert_eq!(list.total, 17);
		assert_eq!(list.visible[0].name, "f15");
	}

	#[test]
	fn other_orders_only_drop_the_noise() {
		let list = listing(&files(), SortMode::Name, false);
		assert_eq!(list.visible.len(), 15);
		assert_eq!(list.visible[0].name, "f01");
		let list = listing(&files(), SortMode::Newest, true);
		assert_eq!(list.visible.len(), 17);
		assert_eq!(list.visible[0].name, "speck");
	}
}
