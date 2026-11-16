// Space Windows keeps for itself at the root of a disk (see
// src/scanner/reserved.rs), grouped by what it's for, the way the legend and
// the sunburst show it.

use observatory_scan::Reserved;
use observatory_scan::reserved::ReservedKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservedGroup {
	pub kind: ReservedKind,
	pub label: &'static str,
	// What it is, and whether there's anything to do about it.
	pub hint: &'static str,
	pub names: Vec<String>,
	pub size: u64,
}

const KINDS: [(ReservedKind, &str, &str); 3] = [
	(
		ReservedKind::Paging,
		"virtual memory",
		"Where Windows moves memory it's short of. Windows sizes it itself.",
	),
	(
		ReservedKind::Hibernation,
		"hibernation",
		"Where Windows saves memory to hibernate, and for fast startup.",
	),
	(
		ReservedKind::Restore,
		"system restore",
		"Restore points and other shadow copies. System Protection sets how much they may use.",
	),
];

pub fn group_reserved(reserved: &[Reserved]) -> Vec<ReservedGroup> {
	KINDS
		.into_iter()
		.filter_map(|(kind, label, hint)| {
			let of: Vec<_> = reserved.iter().filter(|r| r.kind == kind).collect();
			if of.is_empty() {
				return None;
			}
			Some(ReservedGroup {
				kind,
				label,
				hint,
				names: of.iter().map(|r| r.name.clone()).collect(),
				size: of.iter().map(|r| r.size).sum(),
			})
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	fn reserved(name: &str, size: u64, kind: ReservedKind) -> Reserved {
		Reserved {
			name: name.to_string(),
			size,
			kind,
		}
	}

	#[test]
	fn groups_by_kind_in_a_fixed_order() {
		let groups = group_reserved(&[
			reserved("hiberfil.sys", 8, ReservedKind::Hibernation),
			reserved("swapfile.sys", 1, ReservedKind::Paging),
			reserved("pagefile.sys", 4, ReservedKind::Paging),
		]);
		assert_eq!(groups.len(), 2);
		assert_eq!(groups[0].label, "virtual memory");
		assert_eq!(groups[0].names, ["swapfile.sys", "pagefile.sys"]);
		assert_eq!(groups[0].size, 5);
		assert_eq!(groups[1].label, "hibernation");
		assert!(group_reserved(&[]).is_empty());
	}
}
