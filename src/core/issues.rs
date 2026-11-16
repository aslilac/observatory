// What a scan couldn't read, sorted into what a view says about it: the ones
// with a fix (Full Disk Access on macOS, an administrator on Windows) each
// as one issue, and the rest listed by kind.

use observatory_scan::{ScanError, ScanErrorKind};

/// How many of a kind a list shows before it says how many more there are.
pub const LISTED_MAX: usize = 50;

#[derive(Debug, Default)]
pub struct Issues<'a> {
	/// macOS kept the scan out of these, for want of Full Disk Access.
	pub protected: Vec<&'a ScanError>,
	/// Windows kept the scan out of these, which an administrator could see.
	pub admin: Vec<&'a ScanError>,
	/// The rest, by kind, in the order they're listed. No group is empty.
	pub listed: Vec<(&'static str, Vec<&'a ScanError>)>,
}

pub fn group_issues(errors: &[ScanError]) -> Issues<'_> {
	let of = |kind: fn(&ScanErrorKind) -> bool| -> Vec<&ScanError> {
		errors.iter().filter(|e| kind(&e.kind)).collect()
	};
	let listed = [
		(
			"Permission denied",
			of(|k| matches!(k, ScanErrorKind::Permission)),
		),
		(
			"Missing entries",
			of(|k| matches!(k, ScanErrorKind::Missing)),
		),
		("Symlink loops", of(|k| matches!(k, ScanErrorKind::Loop))),
		("Other errors", of(|k| matches!(k, ScanErrorKind::Other))),
	];
	Issues {
		protected: of(|k| matches!(k, ScanErrorKind::Protected)),
		admin: of(|k| matches!(k, ScanErrorKind::Admin)),
		listed: listed
			.into_iter()
			.filter(|(_, errors)| !errors.is_empty())
			.collect(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn error(path: &str, kind: ScanErrorKind) -> ScanError {
		ScanError {
			path: path.to_string(),
			kind,
			code: None,
			message: String::new(),
		}
	}

	#[test]
	fn fixable_ones_stand_apart() {
		let errors = [
			error("/a", ScanErrorKind::Other),
			error("/b", ScanErrorKind::Protected),
			error("/c", ScanErrorKind::Permission),
			error("/d", ScanErrorKind::Protected),
		];
		let issues = group_issues(&errors);
		assert_eq!(issues.protected.len(), 2);
		assert!(issues.admin.is_empty());
		let labels: Vec<_> = issues.listed.iter().map(|(label, _)| *label).collect();
		assert_eq!(labels, ["Permission denied", "Other errors"]);
	}
}
