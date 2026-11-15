// The icons, built into the binary. They're lucide's (ISC), copied out as
// SVG files in `icons/`; gpui rasterizes them as masks, so each takes
// whatever color it's drawn in.

use anyhow::Result;
use gpui::{AssetSource, SharedString};
use std::borrow::Cow;

macro_rules! icons {
	($($name:literal),* $(,)?) => {
		const ICONS: &[(&str, &[u8])] = &[
			$((concat!("icons/", $name, ".svg"), include_bytes!(concat!("icons/", $name, ".svg")))),*
		];
	};
}

icons![
	"archive",
	"arrow-left",
	"arrow-right",
	"arrow-up-right",
	"check",
	"chevron-down",
	"chevron-left",
	"chevron-right",
	"circle-alert",
	"code-xml",
	"disc",
	"file",
	"film",
	"folder-open",
	"folder",
	"hard-drive",
	"hourglass",
	"layers",
	"list-tree",
	"list",
	"loader-circle",
	"moon",
	"rotate-cw",
	"search",
	"server",
	"shield",
	"sun",
	"text-search",
	"trash",
	"weight",
	"x",
];

pub struct Assets;

impl AssetSource for Assets {
	fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
		Ok(ICONS
			.iter()
			.find(|(name, _)| *name == path)
			.map(|(_, bytes)| Cow::Borrowed(*bytes)))
	}

	fn list(&self, path: &str) -> Result<Vec<SharedString>> {
		Ok(ICONS
			.iter()
			.filter(|(name, _)| name.starts_with(path))
			.map(|(name, _)| (*name).into())
			.collect())
	}
}
