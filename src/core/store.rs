// What the app remembers from one run to the next: the theme, the folders
// scanned lately, and what's waiting in cleanup. One JSON file in the user's
// config folder, written whenever any of it changes. Best-effort all the
// way: a file that's missing or mangled is the same as a first run, and one
// that can't be written just isn't remembered.

use crate::format::now_ms;
use crate::paths::is_within;
use crate::tree::Item;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentScan {
	pub path: String,
	pub scanned_at: u64,
}

const RECENT_SCANS_MAX: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
	#[serde(flatten)]
	pub item: Item,
	pub added_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Remembered {
	// None until the user picks one, when the OS's is followed.
	dark: Option<bool>,
	recent_scans: Vec<RecentScan>,
	cleanup: Vec<CleanupItem>,
	// macOS: the first scan asks for Full Disk Access, once.
	full_disk_access_asked: bool,
}

#[derive(Debug, Default)]
pub struct Store {
	// None for a store that's only in memory.
	file: Option<PathBuf>,
	remembered: Remembered,
	// The cleanup queue's paths, kept alongside it for `in_cleanup`.
	queued: HashSet<String>,
}

impl Store {
	/// The store in the user's config folder.
	pub fn open() -> Self {
		let file = dirs::config_dir().map(|dir| dir.join("Observatory").join("settings.json"));
		Self::at(file)
	}

	/// A store kept in `file`, or only in memory.
	pub fn at(file: Option<PathBuf>) -> Self {
		let remembered: Remembered = file
			.as_ref()
			.and_then(|file| std::fs::read(file).ok())
			.and_then(|json| serde_json::from_slice(&json).ok())
			.unwrap_or_default();
		let queued = remembered
			.cleanup
			.iter()
			.map(|queued| queued.item.path.clone())
			.collect();
		Self {
			file,
			remembered,
			queued,
		}
	}

	fn save(&self) {
		let Some(file) = &self.file else {
			return;
		};
		let Ok(json) = serde_json::to_vec_pretty(&self.remembered) else {
			return;
		};
		if let Some(dir) = file.parent() {
			let _ = std::fs::create_dir_all(dir);
		}
		let _ = std::fs::write(file, json);
	}

	/// The theme the user picked, if they have.
	pub fn dark(&self) -> Option<bool> {
		self.remembered.dark
	}

	pub fn set_dark(&mut self, dark: bool) {
		self.remembered.dark = Some(dark);
		self.save();
	}

	pub fn full_disk_access_asked(&self) -> bool {
		self.remembered.full_disk_access_asked
	}

	pub fn set_full_disk_access_asked(&mut self) {
		self.remembered.full_disk_access_asked = true;
		self.save();
	}

	/// The folders scanned lately, latest first.
	pub fn recent_scans(&self) -> &[RecentScan] {
		&self.remembered.recent_scans
	}

	pub fn push_recent(&mut self, path: &str) {
		let recent = &mut self.remembered.recent_scans;
		recent.retain(|entry| entry.path != path);
		recent.insert(
			0,
			RecentScan {
				path: path.to_string(),
				scanned_at: now_ms(),
			},
		);
		recent.truncate(RECENT_SCANS_MAX);
		self.save();
	}

	pub fn remove_recent(&mut self, path: &str) {
		self.remembered.recent_scans.retain(|entry| entry.path != path);
		self.save();
	}

	/// What's waiting to be cleaned up, in the order it was added.
	pub fn cleanup(&self) -> &[CleanupItem] {
		&self.remembered.cleanup
	}

	pub fn cleanup_size(&self) -> u64 {
		self.remembered.cleanup.iter().map(|q| q.item.size).sum()
	}

	/// Whether `path` goes out with the cleanup: it's queued, or a folder
	/// it's in is.
	pub fn in_cleanup(&self, path: &str) -> bool {
		is_within(path, &self.queued)
	}

	/// Queues whatever of `items` isn't already. Says whether any were.
	pub fn add_to_cleanup(&mut self, items: impl IntoIterator<Item = Item>) -> bool {
		let added_at = now_ms();
		let before = self.queued.len();
		for item in items {
			if self.queued.insert(item.path.clone()) {
				self.remembered.cleanup.push(CleanupItem { item, added_at });
			}
		}
		let added = self.queued.len() > before;
		if added {
			self.save();
		}
		added
	}

	pub fn remove_from_cleanup(&mut self, path: &str) {
		if self.queued.remove(path) {
			self.remembered.cleanup.retain(|q| q.item.path != path);
			self.save();
		}
	}

	pub fn clear_cleanup(&mut self) {
		if !self.queued.is_empty() {
			self.queued.clear();
			self.remembered.cleanup.clear();
			self.save();
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn item(path: &str, size: u64) -> Item {
		Item {
			path: path.to_string(),
			name: crate::paths::basename(path).to_string(),
			size,
			directory: true,
		}
	}

	#[test]
	fn remembers_across_runs() {
		let file = std::env::temp_dir().join(format!("observatory-store-{}.json", std::process::id()));
		let _ = std::fs::remove_file(&file);
		let mut store = Store::at(Some(file.clone()));
		assert_eq!(store.dark(), None);
		store.set_dark(true);
		store.push_recent("/a");
		store.push_recent("/b");
		store.push_recent("/a");
		assert!(store.add_to_cleanup([item("/a/x", 5), item("/a/y", 7)]));
		assert!(!store.add_to_cleanup([item("/a/x", 5)]));

		let store = Store::at(Some(file.clone()));
		assert_eq!(store.dark(), Some(true));
		let recent: Vec<_> = store.recent_scans().iter().map(|r| r.path.as_str()).collect();
		assert_eq!(recent, ["/a", "/b"]);
		assert_eq!(store.cleanup_size(), 12);
		assert!(store.in_cleanup("/a/x/deep/inside"));
		assert!(!store.in_cleanup("/a/z"));
		let _ = std::fs::remove_file(&file);
	}

	#[test]
	fn keeps_ten_recents() {
		let mut store = Store::at(None);
		for i in 0..15 {
			store.push_recent(&format!("/{i}"));
		}
		assert_eq!(store.recent_scans().len(), 10);
		assert_eq!(store.recent_scans()[0].path, "/14");
		store.remove_recent("/14");
		assert_eq!(store.recent_scans()[0].path, "/13");
	}

	#[test]
	fn a_mangled_file_is_a_first_run() {
		let file = std::env::temp_dir().join(format!("observatory-mangled-{}.json", std::process::id()));
		std::fs::write(&file, "{ not json").unwrap();
		let store = Store::at(Some(file.clone()));
		assert!(store.recent_scans().is_empty());
		let _ = std::fs::remove_file(&file);
	}
}
