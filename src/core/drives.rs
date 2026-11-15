// The disks and network shares there are to scan, and how full they are.

use observatory_scan::volumes::{Volume, volumes};
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, PoisonError, mpsc};
use std::time::Duration;

// Bytes. `used + available` can fall short of `total`: some filesystems hold
// back blocks that only root can write to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Usage {
	pub total: u64,
	pub used: u64,
	pub available: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Drive {
	pub mount_path: String,
	pub description: String,
	// A share mounted from another machine (SMB, NFS, …) rather than a disk
	// attached to this one.
	pub network: bool,
	// The volume the OS started up from.
	pub startup: bool,
	// On a disk that's plugged in (USB, an SD card) rather than built in.
	pub external: bool,
	// Encrypted at rest (FileVault, LUKS). Always false on Windows.
	pub encrypted: bool,
	// For a share: the machine it's from ("Pecha") and what it's shared over
	// ("SMB"), when the OS says.
	pub server: Option<String>,
	pub protocol: Option<String>,
	// OS-reported space. None if the volume couldn't be asked.
	pub usage: Option<Usage>,
}

// The letter of the Windows drive whose root `path` is: "C:" for `C:\`.
fn drive_letter(path: &str) -> Option<&str> {
	let letter = path.get(..2)?;
	let rest = &path[2..];
	let bytes = letter.as_bytes();
	(bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(rest, "" | "\\" | "/"))
		.then_some(letter)
}

impl Drive {
	/// What the drive's called, wherever it's named. One with a letter has
	/// it after its name, as Explorer does: "Local Disk (C:)".
	pub fn title(&self) -> String {
		match drive_letter(&self.mount_path) {
			Some(letter) => format!("{} ({letter})", self.description),
			None => self.description.clone(),
		}
	}
}

/// What a scan of `path` is called: the drive's title for a whole drive,
/// and otherwise the folder's name. It's the same before, during and after
/// the scan.
pub fn place_name(drives: &[Drive], path: &str) -> String {
	match drives.iter().find(|drive| drive.mount_path == path) {
		Some(drive) => drive.title(),
		None => crate::paths::basename(path).to_string(),
	}
}

// What the OS reports for the volume holding `path` (any path on it, not
// just its mount point), so disks and folders can show how full their
// volume is without scanning it. `used` is whole-volume: on APFS, `/` is a
// sealed system snapshot that shares its container with the Data volume,
// and `total - free` covers the whole container (what Finder calls used),
// where df's per-volume figure for `/` doesn't.
//
// On a network share, this asks the server, and one that has gone away
// leaves the call hanging. So it's made on a thread of its own, there's only
// ever one of a path out at a time, and whoever asks waits for it no longer
// than `patience`: None if it hasn't answered by then, or if one from before
// is still out.
pub fn read_volume_usage(path: &str, patience: Duration) -> Option<Usage> {
	static OUT: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);
	let out = || OUT.lock().unwrap_or_else(PoisonError::into_inner);

	if !out().insert(path.to_string()) {
		return None;
	}
	let (answer, answered) = mpsc::channel();
	let asked = path.to_string();
	std::thread::spawn(move || {
		let usage = fs4::statvfs(&asked).ok().map(|stats| Usage {
			total: stats.total_space(),
			used: stats.total_space().saturating_sub(stats.free_space()),
			available: stats.available_space(),
		});
		out().remove(&asked);
		let _ = answer.send(usage);
	});
	answered.recv_timeout(patience).ok().flatten()
}

/// The drives there are now. `before` is what the last poll found: a share
/// whose server has dropped off the network can take a minute to say how
/// full it is, and rather than hold up the whole list for it, it keeps what
/// it said last time.
pub fn poll(before: &[Drive]) -> Vec<Drive> {
	let polls: Vec<_> = volumes()
		.into_iter()
		.map(|volume| {
			std::thread::spawn(move || {
				let Volume {
					path,
					usage_path,
					name,
					network,
					startup,
					external,
					encrypted,
					server,
					protocol,
				} = volume;
				let usage = read_volume_usage(
					usage_path.as_deref().unwrap_or(&path),
					Duration::from_secs(1),
				);
				Drive {
					mount_path: path,
					description: name,
					network,
					startup,
					external,
					encrypted,
					server,
					protocol,
					usage,
				}
			})
		})
		.collect();
	polls
		.into_iter()
		.filter_map(|poll| poll.join().ok())
		.map(|mut drive| {
			drive.usage = drive.usage.or_else(|| {
				let last = before.iter().find(|b| b.mount_path == drive.mount_path)?;
				last.usage
			});
			drive
		})
		.collect()
}

/// Whether `next` says anything worth showing that `prev` didn't: another
/// drive, or one that's different in something other than how full it is (a
/// drive letter on Windows can go to a different disk between polls), or
/// one whose usage has moved by a visible amount. Free space drifts on every
/// poll, so that's 0.1% of its capacity, finer than the size labels or meter
/// can show.
pub fn changed(prev: &[Drive], next: &[Drive]) -> bool {
	if prev.len() != next.len() {
		return true;
	}
	prev.iter().zip(next).any(|(before, after)| {
		let same_facts = Drive {
			usage: None,
			..before.clone()
		} == Drive {
			usage: None,
			..after.clone()
		};
		!same_facts
			|| match (before.usage, after.usage) {
				(Some(before), Some(after)) => {
					before.used.abs_diff(after.used) > after.total / 1000
				}
				(before, after) => before != after,
			}
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	fn drive(used: u64) -> Drive {
		Drive {
			mount_path: "/".into(),
			description: "Macintosh HD".into(),
			network: false,
			startup: true,
			external: false,
			encrypted: true,
			server: None,
			protocol: None,
			usage: Some(Usage {
				total: 1_000_000,
				used,
				available: 1_000_000 - used,
			}),
		}
	}

	#[test]
	fn only_visible_changes_count() {
		assert!(!changed(&[drive(500_000)], &[drive(500_500)]));
		assert!(changed(&[drive(500_000)], &[drive(502_000)]));
		assert!(changed(&[], &[drive(1)]));
		let mut renamed = drive(500_000);
		renamed.description = "Other".into();
		assert!(changed(&[drive(500_000)], &[renamed]));
	}

	#[test]
	fn a_drive_with_a_letter_is_named_with_it() {
		let mac = drive(1);
		assert_eq!(mac.title(), "Macintosh HD");
		let mut windows = drive(1);
		windows.mount_path = "C:\\".into();
		windows.description = "Local Disk".into();
		assert_eq!(windows.title(), "Local Disk (C:)");

		// A scan of a whole drive is called what the drive is; of a folder,
		// what the folder is.
		let drives = [mac, windows];
		assert_eq!(place_name(&drives, "C:\\"), "Local Disk (C:)");
		assert_eq!(place_name(&drives, "/"), "Macintosh HD");
		assert_eq!(place_name(&drives, "/Users/kayla/"), "kayla");
		// A backslash only comes between names on Windows.
		if cfg!(windows) {
			assert_eq!(place_name(&drives, "C:\\Users\\kayla"), "kayla");
			// A drive that isn't listed (yet) is at least its letter.
			assert_eq!(place_name(&drives, "D:\\"), "D:");
		}
		assert_eq!(drive_letter("C:\\Users"), None);
		assert_eq!(drive_letter("/"), None);
	}

	#[test]
	fn usage_of_this_volume() {
		let usage = read_volume_usage("/", Duration::from_secs(5)).unwrap();
		assert!(usage.total > 0 && usage.used <= usage.total);
	}
}
