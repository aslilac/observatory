// Space Windows keeps for itself at the root of a disk. It shows up as files,
// but none of it is the user's to delete: virtual memory (pagefile.sys, and
// swapfile.sys for Store apps), hibernation (hiberfil.sys), and System
// Restore's shadow copies (in System Volume Information, which only an
// administrator can see into). Windows sizes each itself, and has a setting
// for each. Like macOS's purgeable space, it's counted apart from the rest.

use crate::VfsNode;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReservedKind {
	Paging,
	Hibernation,
	Restore,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Reserved {
	pub name: String,
	pub size: u64,
	pub kind: ReservedKind,
}

fn kind_of(node: &VfsNode) -> Option<ReservedKind> {
	let is = |name: &str| node.name().eq_ignore_ascii_case(name);
	match node {
		VfsNode::File { .. } if is("pagefile.sys") || is("swapfile.sys") => {
			Some(ReservedKind::Paging)
		}
		VfsNode::File { .. } if is("hiberfil.sys") => Some(ReservedKind::Hibernation),
		VfsNode::Directory { .. } if is("System Volume Information") => Some(ReservedKind::Restore),
		_ => None,
	}
}

/// Takes what Windows keeps for itself out of `root`, a disk's root folder,
/// and out of its size.
pub fn take(root: &mut VfsNode) -> Vec<Reserved> {
	let VfsNode::Directory { size, files, .. } = root else {
		return Vec::new();
	};
	let mut reserved = Vec::new();
	files.retain(|node| {
		let Some(kind) = kind_of(node) else {
			return true;
		};
		*size = size.saturating_sub(node.size());
		if node.size() > 0 {
			reserved.push(Reserved {
				name: node.name().to_owned(),
				size: node.size(),
				kind,
			});
		}
		false
	});
	reserved
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

	fn names(node: &VfsNode) -> Vec<&str> {
		match node {
			VfsNode::Directory { files, .. } => files.iter().map(VfsNode::name).collect(),
			VfsNode::File { .. } => Vec::new(),
		}
	}

	#[test]
	fn takes_virtual_memory_hibernation_and_restore_points() {
		let mut root = dir(
			"C:\\",
			vec![
				dir("Users", vec![file("a", 100)]),
				file("pagefile.sys", 30),
				dir("System Volume Information", vec![file("{shadow}", 20)]),
				file("hiberfil.sys", 10),
				file("swapfile.sys", 5),
				file("bootmgr", 1),
			],
		);
		let reserved = take(&mut root);
		assert_eq!(names(&root), ["Users", "bootmgr"]);
		assert_eq!(root.size(), 101);
		let taken: Vec<_> = reserved
			.iter()
			.map(|r| (r.name.as_str(), r.size, r.kind))
			.collect();
		assert_eq!(
			taken,
			[
				("pagefile.sys", 30, ReservedKind::Paging),
				("System Volume Information", 20, ReservedKind::Restore),
				("hiberfil.sys", 10, ReservedKind::Hibernation),
				("swapfile.sys", 5, ReservedKind::Paging),
			]
		);
	}

	#[test]
	fn goes_by_name_whatever_the_case() {
		let mut root = dir("D:\\", vec![file("PAGEFILE.SYS", 8), file("x", 1)]);
		assert_eq!(take(&mut root)[0].name, "PAGEFILE.SYS");
		assert_eq!(root.size(), 1);
	}

	#[test]
	fn leaves_a_folder_or_file_of_the_other_kind_alone() {
		let mut root = dir(
			"E:\\",
			vec![
				dir("pagefile.sys", vec![file("x", 3)]),
				file("System Volume Information", 2),
			],
		);
		assert!(take(&mut root).is_empty());
		assert_eq!(root.size(), 5);
	}

	#[test]
	fn drops_what_it_couldnt_see_into() {
		// Without administrator rights, System Volume Information is empty.
		let mut root = dir(
			"C:\\",
			vec![file("a", 4), dir("System Volume Information", vec![])],
		);
		assert!(take(&mut root).is_empty());
		assert_eq!(names(&root), ["a"]);
	}
}
