// Getting rid of what's in the cleanup queue.

use crate::scans::Scans;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteMode {
	/// For good, which is what frees the space.
	Delete,
	/// To the system's Trash, which frees it once that's emptied.
	Trash,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeleteResult {
	pub deleted: Vec<String>,
	/// The paths that are still there, each with why.
	pub failed: Vec<(String, String)>,
}

/// What's said of a deletion while it goes, a path at a time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
	/// This one's next.
	Starting(String),
	/// It's gone, and out of the scans' trees.
	Deleted(String),
	/// It's still there, and why.
	Failed(String, String),
}

// Delete each path for good, or move it to the system Trash. Best-effort and
// per-path: one bad path doesn't abort the rest. Something that's already
// gone counts as deleted, so it leaves the queue. What's gone is taken out of
// every scan's tree as it goes, so the views stop showing what no longer
// exists.
//
// `tell` hears of each path before and after. Once `stop` is set, no more
// are started: the one in hand is finished (a folder is never left half
// deleted on purpose), and the rest are in neither list of the result.
//
// Deleting a big folder takes a while: not something to call where a frame
// is waiting.
pub fn delete_files(
	scans: &Scans,
	paths: &[String],
	mode: DeleteMode,
	stop: &AtomicBool,
	mut tell: impl FnMut(Step),
) -> DeleteResult {
	let mut result = DeleteResult::default();
	for target in paths {
		if stop.load(Ordering::Relaxed) {
			break;
		}
		tell(Step::Starting(target.clone()));
		match delete(Path::new(target), mode) {
			Ok(()) => {
				scans.remove_path(target);
				result.deleted.push(target.clone());
				tell(Step::Deleted(target.clone()));
			}
			Err(error) => {
				result.failed.push((target.clone(), error.clone()));
				tell(Step::Failed(target.clone(), error));
			}
		}
	}
	result
}

fn delete(target: &Path, mode: DeleteMode) -> Result<(), String> {
	// Never a whole disk, and never somewhere relative to wherever the app
	// happens to be running.
	if !target.is_absolute() || target.parent().is_none() {
		return Err("Not something that can be deleted".to_string());
	}
	let metadata = match target.symlink_metadata() {
		Ok(metadata) => metadata,
		Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
		Err(error) => return Err(error.to_string()),
	};
	match mode {
		DeleteMode::Trash => trash(target),
		DeleteMode::Delete if metadata.is_dir() => {
			std::fs::remove_dir_all(target).map_err(|error| error.to_string())
		}
		DeleteMode::Delete => std::fs::remove_file(target).map_err(|error| error.to_string()),
	}
}

fn trash(target: &Path) -> Result<(), String> {
	#[allow(unused_mut)]
	let mut context = trash::TrashContext::default();
	// Through NSFileManager, rather than by asking Finder, which macOS would
	// first want the user to allow the app to control.
	#[cfg(target_os = "macos")]
	{
		use trash::macos::{DeleteMethod, TrashContextExtMacos};
		context.set_delete_method(DeleteMethod::NsFileManager);
	}
	context.delete(target).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn deletes_what_is_there_and_shrugs_at_what_is_not() {
		let dir = std::env::temp_dir().join(format!("observatory-cleanup-{}", std::process::id()));
		std::fs::create_dir_all(dir.join("folder/inner")).unwrap();
		std::fs::write(dir.join("folder/inner/file"), "x").unwrap();
		std::fs::write(dir.join("file"), "x").unwrap();
		let path = |name: &str| dir.join(name).to_string_lossy().into_owned();

		let scans = Scans::new(|_| {});
		let mut steps = Vec::new();
		let result = delete_files(
			&scans,
			&[
				path("folder"),
				path("file"),
				path("never-was"),
				"/".to_string(),
				"relative/path".to_string(),
			],
			DeleteMode::Delete,
			&AtomicBool::new(false),
			|step| steps.push(step),
		);
		// Each is announced, then said to be gone or not.
		assert_eq!(steps.len(), 10);
		assert_eq!(steps[0], Step::Starting(path("folder")));
		assert_eq!(steps[1], Step::Deleted(path("folder")));
		assert!(matches!(&steps[7], Step::Failed(path, _) if path == "/"));
		assert_eq!(
			result.deleted,
			[path("folder"), path("file"), path("never-was")]
		);
		let failed: Vec<_> = result
			.failed
			.iter()
			.map(|(path, _)| path.as_str())
			.collect();
		assert_eq!(failed, ["/", "relative/path"]);
		assert!(!dir.join("folder").exists() && !dir.join("file").exists());
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn stops_before_the_next_one() {
		let dir = std::env::temp_dir().join(format!("observatory-stop-{}", std::process::id()));
		std::fs::create_dir_all(&dir).unwrap();
		for name in ["one", "two", "three"] {
			std::fs::write(dir.join(name), "x").unwrap();
		}
		let path = |name: &str| dir.join(name).to_string_lossy().into_owned();

		let scans = Scans::new(|_| {});
		let stop = AtomicBool::new(false);
		let result = delete_files(
			&scans,
			&[path("one"), path("two"), path("three")],
			DeleteMode::Delete,
			&stop,
			// Asked to stop while the first is in hand.
			|step| {
				if matches!(step, Step::Starting(_)) {
					stop.store(true, Ordering::Relaxed);
				}
			},
		);
		assert_eq!(result.deleted, [path("one")]);
		assert!(result.failed.is_empty());
		assert!(dir.join("two").exists() && dir.join("three").exists());
		let _ = std::fs::remove_dir_all(&dir);
	}
}
