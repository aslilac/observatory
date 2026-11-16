// What the app remembers from one run to the next: the theme, the folders
// scanned lately, and what each scan has waiting in cleanup. One JSON file in the user's
// config folder, written whenever any of it changes. Best-effort all the
// way: a file that's missing or mangled is the same as a first run, and one
// that can't be written just isn't remembered.

use crate::format::now_ms;
use crate::paths::is_within;
use crate::tree::Item;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
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
	/// What color it was in the sunburst when it was queued, if that was
	/// known, so it's the same color in the queue.
	#[serde(default)]
	pub tint: Option<Tint>,
}

/// Where something's color comes from in a sunburst: see
/// `color::sunburst_color`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tint {
	/// In whole degrees, which is as near as anyone can see.
	pub hue: u16,
	/// How far below the scan's root its folder is.
	pub depth: u16,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Remembered {
	// None until the user picks one, when the OS's is followed.
	dark: Option<bool>,
	recent_scans: Vec<RecentScan>,
	// A queue for each scan that has anything in one, by the scan's path.
	// (Before, there was one for them all, `cleanup`, which is left behind:
	// there's no saying which scan each thing in it was queued from.)
	cleanups: BTreeMap<String, Vec<CleanupItem>>,
	// macOS: the first scan asks for Full Disk Access, once.
	full_disk_access_asked: bool,
}

#[derive(Debug, Default)]
pub struct Store {
	// None for a store that's only in memory.
	file: Option<PathBuf>,
	remembered: Remembered,
	// Each cleanup queue's paths, kept alongside it for `in_cleanup`.
	queued: HashMap<String, HashSet<String>>,
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
			.cleanups
			.iter()
			.map(|(scan, queue)| {
				let paths = queue.iter().map(|queued| queued.item.path.clone());
				(scan.clone(), paths.collect())
			})
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
		self.remembered
			.recent_scans
			.retain(|entry| entry.path != path);
		self.save();
	}

	// Cleanup. Each scan has a queue of its own, named here by the scan's
	// path (`scan`): what's queued while looking at one scan is that scan's to
	// clean up, and isn't there in another.

	/// What's waiting to be cleaned up from `scan`, in the order it was
	/// added.
	pub fn cleanup(&self, scan: &str) -> &[CleanupItem] {
		self.remembered
			.cleanups
			.get(scan)
			.map_or(&[], Vec::as_slice)
	}

	pub fn cleanup_size(&self, scan: &str) -> u64 {
		self.cleanup(scan).iter().map(|q| q.item.size).sum()
	}

	/// Whether `path` goes out with `scan`'s cleanup: it's queued, or a
	/// folder it's in is.
	pub fn in_cleanup(&self, scan: &str, path: &str) -> bool {
		self.queued
			.get(scan)
			.is_some_and(|queued| is_within(path, queued))
	}

	/// Queues whatever of `items` isn't already, each with the color `tint`
	/// says it has. Says whether any were.
	pub fn add_to_cleanup(
		&mut self,
		scan: &str,
		items: impl IntoIterator<Item = Item>,
		tint: impl Fn(&Item) -> Option<Tint>,
	) -> bool {
		let added_at = now_ms();
		let mut added = false;
		for item in items {
			let queued = self.queued.entry(scan.to_string()).or_default();
			if queued.insert(item.path.clone()) {
				let tint = tint(&item);
				let queue = self.remembered.cleanups.entry(scan.to_string());
				queue.or_default().push(CleanupItem {
					item,
					added_at,
					tint,
				});
				added = true;
			}
		}
		if added {
			self.save();
		}
		added
	}

	pub fn remove_from_cleanup(&mut self, scan: &str, path: &str) {
		if self.unqueue(scan, path) {
			self.save();
		}
	}

	/// `path` has been deleted: it's out of every scan's queue, since scans
	/// can overlap (a disk, and a folder on it).
	pub fn remove_deleted(&mut self, path: &str) {
		let scans: Vec<String> = self.queued.keys().cloned().collect();
		let mut removed = false;
		for scan in scans {
			removed |= self.unqueue(&scan, path);
		}
		if removed {
			self.save();
		}
	}

	// Takes `path` out of `scan`'s queue, and says whether it was in it. A
	// queue with nothing left in it isn't kept.
	fn unqueue(&mut self, scan: &str, path: &str) -> bool {
		let Some(queued) = self.queued.get_mut(scan) else {
			return false;
		};
		if !queued.remove(path) {
			return false;
		}
		if queued.is_empty() {
			self.queued.remove(scan);
			self.remembered.cleanups.remove(scan);
		} else if let Some(queue) = self.remembered.cleanups.get_mut(scan) {
			queue.retain(|q| q.item.path != path);
		}
		true
	}

	pub fn clear_cleanup(&mut self, scan: &str) {
		if self.queued.remove(scan).is_some() {
			self.remembered.cleanups.remove(scan);
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
		let file =
			std::env::temp_dir().join(format!("observatory-store-{}.json", std::process::id()));
		let _ = std::fs::remove_file(&file);
		let mut store = Store::at(Some(file.clone()));
		assert_eq!(store.dark(), None);
		store.set_dark(true);
		store.push_recent("/a");
		store.push_recent("/b");
		store.push_recent("/a");
		assert!(store.add_to_cleanup("/a", [item("/a/x", 5), item("/a/y", 7)], |_| None));
		assert!(!store.add_to_cleanup("/a", [item("/a/x", 5)], |_| None));

		let store = Store::at(Some(file.clone()));
		assert_eq!(store.dark(), Some(true));
		let recent: Vec<_> = store
			.recent_scans()
			.iter()
			.map(|r| r.path.as_str())
			.collect();
		assert_eq!(recent, ["/a", "/b"]);
		assert_eq!(store.cleanup_size("/a"), 12);
		assert!(store.in_cleanup("/a", "/a/x/deep/inside"));
		assert!(!store.in_cleanup("/a", "/a/z"));
		let _ = std::fs::remove_file(&file);
	}

	#[test]
	fn each_scan_has_its_own_cleanup() {
		let mut store = Store::at(None);
		store.add_to_cleanup("/", [item("/a/x", 5), item("/b", 3)], |_| None);
		store.add_to_cleanup("/a", [item("/a/x", 5), item("/a/y", 7)], |_| None);
		assert_eq!(store.cleanup_size("/"), 8);
		assert_eq!(store.cleanup_size("/a"), 12);
		assert!(store.in_cleanup("/", "/b"));
		assert!(!store.in_cleanup("/a", "/b"));
		assert!(store.cleanup("/elsewhere").is_empty());

		store.remove_from_cleanup("/a", "/a/y");
		assert_eq!(store.cleanup_size("/a"), 5);
		// Once it's deleted, it's queued nowhere.
		store.remove_deleted("/a/x");
		assert_eq!(store.cleanup_size("/"), 3);
		assert!(store.cleanup("/a").is_empty());
		store.clear_cleanup("/");
		assert!(!store.in_cleanup("/", "/b"));
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
		let file =
			std::env::temp_dir().join(format!("observatory-mangled-{}.json", std::process::id()));
		std::fs::write(&file, "{ not json").unwrap();
		let store = Store::at(Some(file.clone()));
		assert!(store.recent_scans().is_empty());
		let _ = std::fs::remove_file(&file);
	}
}
