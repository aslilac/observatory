// What find offers before anything's typed: the kinds of things that tend to
// be worth cleaning up (src/scanner/find.rs), in the order they're listed.

use observatory_scan::find::Finder;

pub struct FinderInfo {
	pub finder: Finder,
	pub label: &'static str,
	pub description: &'static str,
	/// The name of a lucide icon.
	pub icon: &'static str,
}

pub const FINDERS: [FinderInfo; 7] = [
	FinderInfo {
		finder: Finder::Large,
		label: "Large files",
		description: "Files of 100 MB or more",
		icon: "weight",
	},
	FinderInfo {
		finder: Finder::Old,
		label: "Untouched for a year",
		description: "Nothing in them has changed in a year",
		icon: "hourglass",
	},
	FinderInfo {
		finder: Finder::Videos,
		label: "Videos",
		description: "Movies, clips, and screen recordings",
		icon: "film",
	},
	FinderInfo {
		finder: Finder::Installers,
		label: "Installers",
		description: "Disk images and installer packages",
		icon: "disc",
	},
	FinderInfo {
		finder: Finder::Archives,
		label: "Archives",
		description: "Zip files, tarballs, and the like",
		icon: "archive",
	},
	FinderInfo {
		finder: Finder::Developer,
		label: "Developer files",
		description: "node_modules, build output, and the like",
		icon: "code-xml",
	},
	FinderInfo {
		finder: Finder::Caches,
		label: "Caches",
		description: "Apps make these again when they're gone",
		icon: "layers",
	},
];

pub fn finder_info(finder: Finder) -> &'static FinderInfo {
	FINDERS
		.iter()
		.find(|info| info.finder == finder)
		.expect("every finder is listed")
}
