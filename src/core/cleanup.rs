// Getting rid of what's in the cleanup queue.

use crate::scans::Scans;
use std::io;
use std::path::Path;

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

// Delete each path for good, or move it to the system Trash. Best-effort and
// per-path: one bad path doesn't abort the rest. Something that's already
// gone counts as deleted, so it leaves the queue. What's gone is taken out of
// every scan's tree too, so the views stop showing what no longer exists.
//
// Deleting a big folder takes a while: not something to call where a frame
// is waiting.
pub fn delete_files(scans: &Scans, paths: &[String], mode: DeleteMode) -> DeleteResult {
	let mut result = DeleteResult::default();
	for target in paths {
		match delete(Path::new(target), mode) {
			Ok(()) => result.deleted.push(target.clone()),
			Err(error) => result.failed.push((target.clone(), error)),
		}
	}
	for target in &result.deleted {
		scans.remove_path(target);
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
		);
		assert_eq!(result.deleted, [path("folder"), path("file"), path("never-was")]);
		let failed: Vec<_> = result.failed.iter().map(|(path, _)| path.as_str()).collect();
		assert_eq!(failed, ["/", "relative/path"]);
		assert!(!dir.join("folder").exists() && !dir.join("file").exists());
		let _ = std::fs::remove_dir_all(&dir);
	}
}
