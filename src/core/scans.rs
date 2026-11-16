// The scans there are, and the disks there are to scan: the one thing that
// owns the truth, which every view asks.
//
// A scan's tree stays here, behind its entry. Views get slices of it
// (`render_tree`), what a search finds in it (`find`, `summarize`), and are
// told when anything changes, through the callback `Scans` is made with. That
// can come from any thread: the walk runs on one of its own, and so does the
// poll of the drives.

use crate::color::hues_by_position;
use crate::drives::{self, Drive};
use crate::paths::parts_below;
use crate::tree::{RenderTree, assemble};
use observatory_scan::find::{self, Found, Query, Summary};
use observatory_scan::{
	CountsSnapshot, Reserved, ScanError, ScanErrorKind, ScanState, TopSnapshot, Tree, run_scan,
	tree,
};
use std::io;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
	Building,
	Complete,
	Failed,
}

#[derive(Debug, Clone)]
pub struct ScanInfo {
	pub path: String,
	pub status: Status,
	/// The root's size, once the scan is complete.
	pub size: Option<u64>,
	/// Why, for one that failed.
	pub error: Option<ScanError>,
	/// Goes up whenever what the scan holds changes: when it completes, and
	/// when something's removed from its tree.
	pub revision: u64,
}

/// The name and capacity of the disk a scan covers the whole of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanDrive {
	pub name: String,
	pub capacity: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct Progress {
	pub counts: CountsSnapshot,
	pub current_path: Option<String>,
	/// The folders in the scan's root, by name, and how much has been found
	/// in each so far. Empty until the root's been listed.
	pub tops: Vec<TopSnapshot>,
	/// The size of the files in the root itself so far.
	pub loose: u64,
}

impl Progress {
	/// How much has been found so far.
	pub fn found(&self) -> u64 {
		self.loose + self.tops.iter().map(|top| top.size).sum::<u64>()
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
	Drives,
	Scans,
}

/// The prefix of a scan that isn't of anything on disk (see fake_disk.rs).
pub const FAKE: &str = "fake://";

struct Entry {
	// Tells this entry from another of the same path, started after this one
	// was cancelled.
	id: u64,
	status: Status,
	// The walk's shared state, while it runs.
	state: Option<Arc<ScanState>>,
	// The finished tree. Behind a lock of its own, so a search that takes a
	// while holds up neither the list of scans nor other reads of the tree.
	tree: Option<Arc<RwLock<Tree>>>,
	// Set on completion if the scan covered a whole disk.
	drive: Option<ScanDrive>,
	// Set on completion: what the scanner took out of the root, on a scan of
	// a whole Windows disk (see src/scanner/reserved.rs).
	reserved: Vec<Reserved>,
	errors: Arc<Vec<ScanError>>,
	revision: u64,
}

struct Inner {
	// In the order they were started.
	entries: Mutex<Vec<(String, Entry)>>,
	drives: Mutex<Vec<Drive>>,
	next_id: Mutex<u64>,
	changed: Box<dyn Fn(Change) + Send + Sync>,
}

#[derive(Clone)]
pub struct Scans {
	inner: Arc<Inner>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
	mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Scans {
	/// `changed` is called, from whichever thread, after the drives or the
	/// scans change.
	pub fn new(changed: impl Fn(Change) + Send + Sync + 'static) -> Self {
		Self {
			inner: Arc::new(Inner {
				entries: Mutex::default(),
				drives: Mutex::default(),
				next_id: Mutex::new(0),
				changed: Box::new(changed),
			}),
		}
	}

	/// Starts looking for drives, now and every five seconds from then on.
	pub fn watch_drives(&self) {
		let inner = Arc::downgrade(&self.inner);
		std::thread::spawn(move || {
			loop {
				let Some(inner) = inner.upgrade() else {
					return;
				};
				let before = lock(&inner.drives).clone();
				let next = drives::poll(&before);
				if drives::changed(&before, &next) {
					*lock(&inner.drives) = next;
					(inner.changed)(Change::Drives);
				}
				drop(inner);
				std::thread::sleep(Duration::from_secs(5));
			}
		});
	}

	pub fn drives(&self) -> Vec<Drive> {
		lock(&self.inner.drives).clone()
	}

	pub fn list(&self) -> Vec<ScanInfo> {
		lock(&self.inner.entries)
			.iter()
			.map(|(path, entry)| info(path, entry))
			.collect()
	}

	pub fn get(&self, path: &str) -> Option<ScanInfo> {
		let entries = lock(&self.inner.entries);
		let (path, entry) = entries.iter().find(|(p, _)| p == path)?;
		Some(info(path, entry))
	}

	fn tree(&self, path: &str) -> Option<Arc<RwLock<Tree>>> {
		let entries = lock(&self.inner.entries);
		let (_, entry) = entries.iter().find(|(p, _)| p == path)?;
		entry
			.tree
			.clone()
			.filter(|_| entry.status == Status::Complete)
	}

	/// What there is to draw of the folder at `cursor` in the scan of
	/// `path`. None if the scan isn't complete, or has no such folder.
	pub fn render_tree(&self, path: &str, cursor: &[String]) -> Option<RenderTree> {
		let (tree, drive, reserved) = {
			let entries = lock(&self.inner.entries);
			let (_, entry) = entries.iter().find(|(p, _)| p == path)?;
			if entry.status != Status::Complete {
				return None;
			}
			(
				entry.tree.clone()?,
				entry.drive.clone(),
				entry.reserved.clone(),
			)
		};
		let tree = tree.read().unwrap_or_else(PoisonError::into_inner);
		let slice = tree::render_slice(&tree, cursor)?;
		Some(assemble(&slice, cursor, drive.as_ref(), &reserved))
	}

	/// Where `target`'s color comes from in the sunburst of the scan of
	/// `path`: its hue, and how far below the scan's root its folder is (see
	/// `color::sunburst_color`). None if it isn't in that scan.
	pub fn tint(&self, path: &str, target: &str) -> Option<(f64, usize)> {
		let mut folder = parts_below(path, target);
		let name = folder.pop()?;
		let tree = self.render_tree(path, &folder)?;
		let at = tree.list.iter().position(|node| node.name == name)?;
		let hues = hues_by_position(
			tree.list.iter().map(|node| node.size),
			tree.position,
			tree.root_size,
		);
		Some((*hues.get(at)?, folder.len()))
	}

	pub fn errors(&self, path: &str) -> Arc<Vec<ScanError>> {
		lock(&self.inner.entries)
			.iter()
			.find(|(p, _)| p == path)
			.map(|(_, entry)| entry.errors.clone())
			.unwrap_or_default()
	}

	/// Everything `query` matches below the folder at `cursor`. Walks the
	/// whole of it, so not something to call where a frame is waiting.
	pub fn find(&self, path: &str, cursor: &[String], query: &Query) -> Option<Found> {
		let tree = self.tree(path)?;
		let tree = tree.read().unwrap_or_else(PoisonError::into_inner);
		find::find(&tree, path, cursor, query)
	}

	/// How much each finder finds below the folder at `cursor`. As slow as
	/// `find`.
	pub fn summarize(&self, path: &str, cursor: &[String]) -> Option<Vec<Summary>> {
		let tree = self.tree(path)?;
		let tree = tree.read().unwrap_or_else(PoisonError::into_inner);
		find::summarize(&tree, path, cursor)
	}

	/// How far along a scan that's still running is.
	pub fn progress(&self, path: &str) -> Option<Progress> {
		let entries = lock(&self.inner.entries);
		let (_, entry) = entries.iter().find(|(p, _)| p == path)?;
		let state = entry.state.as_ref()?;
		// By name, so each keeps its place for as long as the scan runs.
		let mut tops = state.tops();
		tops.sort_by_cached_key(|top| top.name.to_lowercase());
		Some(Progress {
			counts: state.counts.snapshot(),
			current_path: lock(&state.current_path).clone(),
			tops,
			loose: state.loose(),
		})
	}

	fn next_id(&self) -> u64 {
		let mut next = lock(&self.inner.next_id);
		*next += 1;
		*next
	}

	/// Starts a scan of `path`, unless there's one already (running or
	/// finished).
	pub fn start(&self, path: &str) {
		let id = self.next_id();
		let state = {
			let mut entries = lock(&self.inner.entries);
			// A failed entry doesn't block a retry: the folder may be back, or
			// the drive reconnected, since the last attempt.
			match entries.iter().position(|(p, _)| p == path) {
				Some(at) if entries[at].1.status == Status::Failed => {
					entries.remove(at);
				}
				Some(_) => return,
				None => {}
			}
			// Stats the root, and fails if it can't (the path doesn't exist,
			// say). That's recorded as a failed entry with the error attached,
			// so there's something to explain rather than a spinner forever.
			match ScanState::for_path(Path::new(path), false) {
				Ok(state) => {
					let state = Arc::new(state);
					entries.push((
						path.to_string(),
						Entry {
							id,
							status: Status::Building,
							state: Some(state.clone()),
							tree: None,
							drive: None,
							reserved: Vec::new(),
							errors: Arc::default(),
							revision: 0,
						},
					));
					Some(state)
				}
				Err(error) => {
					entries.push((path.to_string(), failed(id, path, &error, 1)));
					None
				}
			}
		};
		(self.inner.changed)(Change::Scans);
		let Some(state) = state else {
			return;
		};

		let inner = self.inner.clone();
		let path = path.to_string();
		let walk = std::thread::Builder::new().name("scan".to_string());
		let spawned = walk.spawn(move || {
			let result = run_scan(Path::new(&path), &state);
			{
				let mut entries = lock(&inner.entries);
				// `cancel` may have removed the entry while the walk ran; it
				// already said so, and there's nothing else to do.
				let Some((_, entry)) = entries.iter_mut().find(|(p, e)| *p == path && e.id == id)
				else {
					return;
				};
				let revision = entry.revision + 1;
				match result {
					Ok(result) => {
						entry.drive = scan_drive(&lock(&inner.drives), &path);
						entry.reserved = result.reserved;
						entry.errors = Arc::new(result.errors);
						entry.tree = Some(Arc::new(RwLock::new(result.tree)));
						entry.state = None;
						entry.status = Status::Complete;
						entry.revision = revision;
					}
					Err(error) => *entry = failed(id, &path, &error, revision),
				}
			}
			(inner.changed)(Change::Scans);
		});
		if let Err(error) = spawned {
			let mut entries = lock(&self.inner.entries);
			if let Some((path, entry)) = entries.iter_mut().find(|(_, e)| e.id == id) {
				*entry = failed(id, path, &error, 1);
			}
		}
	}

	/// Throws out the finished scan of `path` and walks it again, for when
	/// files have changed outside the app. A scan that's still running is
	/// already as fresh as it gets, and a fake disk has nothing on disk to
	/// re-read.
	pub fn rescan(&self, path: &str) {
		if path.starts_with(FAKE) {
			return;
		}
		{
			let mut entries = lock(&self.inner.entries);
			match entries.iter().position(|(p, _)| p == path) {
				Some(at) if entries[at].1.status == Status::Building => return,
				Some(at) => {
					entries.remove(at);
				}
				None => {}
			}
		}
		self.start(path);
	}

	/// Stops a scan that's running, and forgets one that isn't. Cancelling is
	/// cooperative: the walk checks at each folder, and unwinds from there.
	pub fn cancel(&self, path: &str) {
		{
			let mut entries = lock(&self.inner.entries);
			let Some(at) = entries.iter().position(|(p, _)| p == path) else {
				return;
			};
			let (_, entry) = entries.remove(at);
			if let Some(state) = entry.state {
				state.aborted.store(true, Ordering::Relaxed);
			}
		}
		(self.inner.changed)(Change::Scans);
	}

	/// A finished scan of something that isn't on disk: a tree as JSON (as
	/// the scanner writes them), of a made-up disk called `name` that holds
	/// `capacity` bytes. Hands back the path it's listed at.
	pub fn start_fake(
		&self,
		name: &str,
		json: &str,
		capacity: Option<u64>,
	) -> serde_json::Result<String> {
		let path = format!("{FAKE}{name}");
		{
			let mut entries = lock(&self.inner.entries);
			if entries.iter().any(|(p, _)| *p == path) {
				return Ok(path);
			}
			let tree = Tree::from_json(json)?;
			let drive = ScanDrive {
				name: tree.name(&tree.root).to_string(),
				capacity,
			};
			entries.push((
				path.clone(),
				Entry {
					id: self.next_id(),
					status: Status::Complete,
					state: None,
					tree: Some(Arc::new(RwLock::new(tree))),
					drive: Some(drive),
					reserved: Vec::new(),
					errors: Arc::default(),
					revision: 1,
				},
			));
		}
		(self.inner.changed)(Change::Scans);
		Ok(path)
	}

	/// Drops a path from every scan's tree that has it, taking its size off
	/// every folder it was in. Used after a cleanup, so what's gone isn't
	/// shown any more. Scans can nest (someone scanned both /Users/alice and
	/// /Users/alice/Movies), and each has its own tree.
	pub fn remove_path(&self, target: &str) {
		let mut changed = false;
		for (root, entry) in lock(&self.inner.entries).iter_mut() {
			let Some(tree) = entry.tree.as_ref() else {
				continue;
			};
			let parts = parts_below(root, target);
			if parts.is_empty() {
				continue;
			}
			let mut tree = tree.write().unwrap_or_else(PoisonError::into_inner);
			if tree::remove(&mut tree, &parts) {
				entry.revision += 1;
				changed = true;
			}
		}
		if changed {
			(self.inner.changed)(Change::Scans);
		}
	}
}

fn info(path: &str, entry: &Entry) -> ScanInfo {
	ScanInfo {
		path: path.to_string(),
		status: entry.status,
		size: entry.tree.as_ref().and_then(|tree| {
			// A search may be reading it, but nothing holds it to write for
			// long.
			Some(tree.read().ok()?.root.size())
		}),
		error: (entry.status == Status::Failed)
			.then(|| entry.errors.first().cloned())
			.flatten(),
		revision: entry.revision,
	}
}

// If the scan's root is a drive's mount path, the drive's name and capacity.
// The capacity is what the legend's free-space row and the root sunburst are
// measured against, and the name is what the scan is called in the title bar.
// The scanner itself doesn't know about drives, by design.
fn scan_drive(drives: &[Drive], path: &str) -> Option<ScanDrive> {
	let drive = drives.iter().find(|drive| drive.mount_path == path)?;
	Some(ScanDrive {
		name: drive.title(),
		capacity: drive.usage.map(|usage| usage.total),
	})
}

fn failed(id: u64, path: &str, error: &io::Error, revision: u64) -> Entry {
	Entry {
		id,
		status: Status::Failed,
		state: None,
		tree: None,
		drive: None,
		reserved: Vec::new(),
		errors: Arc::new(vec![root_error(path, error)]),
		revision,
	}
}

// The scanner only says what went wrong at the root in words, so the root is
// stat-ed again here to tell "it's gone" from "it can't be read": a view
// words those very differently.
fn root_error(path: &str, error: &io::Error) -> ScanError {
	let message = error.to_string();
	let kind = match std::fs::metadata(path).map_err(|e| e.kind()) {
		Err(io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) => ScanErrorKind::Missing,
		Err(io::ErrorKind::PermissionDenied) => ScanErrorKind::Permission,
		_ => ScanErrorKind::Other,
	};
	ScanError {
		path: path.to_string(),
		kind,
		code: None,
		message,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::mpsc;

	const DISK: &str = r#"{"type":"directory","name":"Disk","size":30,"mtime":0,"files":[
		{"type":"directory","name":"a","size":20,"mtime":0,"files":[
			{"type":"file","name":"big","size":20,"mtime":0}]},
		{"type":"file","name":"b","size":10,"mtime":0}]}"#;

	#[test]
	fn a_fake_disk_is_complete_and_can_be_cut_into() {
		let scans = Scans::new(|_| {});
		let path = scans.start_fake("disk", DISK, Some(100)).unwrap();
		assert_eq!(path, "fake://disk");
		let info = scans.get(&path).unwrap();
		assert_eq!((info.status, info.size), (Status::Complete, Some(30)));

		let root = scans.render_tree(&path, &[]).unwrap();
		assert_eq!(
			(root.name.as_str(), root.capacity, root.size),
			("Disk", 100, 30)
		);
		let a = scans.render_tree(&path, &["a".to_string()]).unwrap();
		assert_eq!((a.capacity, a.root_capacity, a.list.len()), (20, 100, 1));
		assert!(scans.render_tree(&path, &["b".to_string()]).is_none());

		// `a` is the first two thirds of the disk, so its hue is a third of
		// the way round, and it's in the root.
		let (hue, depth) = scans.tint(&path, "fake://disk/a").unwrap();
		assert!((hue - 120.0).abs() < 1e-9);
		assert_eq!(depth, 0);
		assert!(scans.tint(&path, "fake://disk/never-was").is_none());
		assert!(scans.tint(&path, "/somewhere/else").is_none());
	}

	#[test]
	fn a_real_folder_scans_and_shrinks_when_something_goes() {
		let dir = std::env::temp_dir().join(format!("observatory-core-{}", std::process::id()));
		std::fs::create_dir_all(dir.join("sub")).unwrap();
		std::fs::write(dir.join("sub/file"), vec![1u8; 10_000]).unwrap();
		let path = dir.to_str().unwrap().to_string();

		let (tell, told) = mpsc::channel();
		let scans = Scans::new(move |change| {
			let _ = tell.send(change);
		});
		scans.start(&path);
		// Once for the start, once for the end.
		for _ in 0..2 {
			assert_eq!(
				told.recv_timeout(Duration::from_secs(10)).unwrap(),
				Change::Scans
			);
		}
		let info = scans.get(&path).unwrap();
		assert_eq!(info.status, Status::Complete);
		let before = info.size.unwrap();
		assert!(before >= 10_000);

		scans.remove_path(&dir.join("sub/file").to_string_lossy());
		let after = scans.get(&path).unwrap();
		assert!(after.size.unwrap() < before);
		assert_eq!(after.revision, info.revision + 1);
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn a_missing_folder_fails_and_says_why() {
		let scans = Scans::new(|_| {});
		scans.start("/nowhere/at/all");
		let info = scans.get("/nowhere/at/all").unwrap();
		assert_eq!(info.status, Status::Failed);
		assert!(matches!(info.error.unwrap().kind, ScanErrorKind::Missing));
	}
}
