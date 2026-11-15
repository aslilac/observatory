// Version numbers as Cargo.toml and the release tags have them (1.2.0,
// v1.0.0-beta.1), compared by semver's rules.

use std::cmp::Ordering;

struct Version<'a> {
	release: [u64; 3],
	prerelease: Vec<&'a str>,
}

fn parse(version: &str) -> Option<Version<'_>> {
	let version = version.strip_prefix('v').unwrap_or(version);
	// Build metadata says nothing about which came first.
	let version = version.split_once('+').map_or(version, |(version, _)| version);
	let (release, prerelease) = match version.split_once('-') {
		Some((release, prerelease)) => (release, Some(prerelease)),
		None => (version, None),
	};
	let mut numbers = release.split('.').map(|n| {
		n.bytes()
			.all(|b| b.is_ascii_digit())
			.then(|| n.parse().ok())
			.flatten()
	});
	let release = [numbers.next()??, numbers.next()??, numbers.next()??];
	if numbers.next().is_some() {
		return None;
	}
	let prerelease: Vec<_> = prerelease.map_or_else(Vec::new, |p| p.split('.').collect());
	let identifier = |id: &&str| {
		!id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
	};
	prerelease.iter().all(identifier).then_some(Version {
		release,
		prerelease,
	})
}

// A prerelease (1.0.0-beta.1) comes before its release (1.0.0). Between
// two of the same release, identifiers that are numbers count numerically,
// and before any that aren't, and a shorter run of them comes first when
// the rest are the same.
fn compare(a: &Version, b: &Version) -> Ordering {
	let by = a.release.cmp(&b.release);
	if by != Ordering::Equal {
		return by;
	}
	if a.prerelease.is_empty() || b.prerelease.is_empty() {
		return b.prerelease.len().cmp(&a.prerelease.len());
	}
	for (x, y) in a.prerelease.iter().zip(&b.prerelease) {
		let by = match (x.parse::<u64>(), y.parse::<u64>()) {
			(Ok(x), Ok(y)) => x.cmp(&y),
			(Ok(_), Err(_)) => Ordering::Less,
			(Err(_), Ok(_)) => Ordering::Greater,
			(Err(_), Err(_)) => x.cmp(y),
		};
		if by != Ordering::Equal {
			return by;
		}
	}
	a.prerelease.len().cmp(&b.prerelease.len())
}

/// Whether `version` comes after `than`. Never, if either isn't a version.
pub fn is_newer(version: &str, than: &str) -> bool {
	match (parse(version), parse(than)) {
		(Some(a), Some(b)) => compare(&a, &b) == Ordering::Greater,
		_ => false,
	}
}

#[cfg(test)]
mod tests {
	use super::is_newer;

	#[test]
	fn releases() {
		assert!(is_newer("1.2.0", "1.1.9"));
		assert!(is_newer("v2.0.0", "1.9.9"));
		assert!(is_newer("1.10.0", "1.9.0"));
		assert!(!is_newer("1.0.0", "1.0.0"));
		assert!(!is_newer("1.0.0", "1.0.1"));
	}

	#[test]
	fn prereleases() {
		assert!(is_newer("1.0.0", "1.0.0-beta.3"));
		assert!(!is_newer("1.0.0-beta.3", "1.0.0"));
		assert!(is_newer("1.0.0-beta.10", "1.0.0-beta.9"));
		assert!(is_newer("1.0.0-beta.1", "1.0.0-alpha.7"));
		assert!(is_newer("1.0.0-beta.1", "1.0.0-beta"));
		assert!(is_newer("1.0.0-beta", "1.0.0-1"));
		assert!(!is_newer("1.0.0+build.2", "1.0.0+build.1"));
	}

	#[test]
	fn not_versions() {
		assert!(!is_newer("latest", "1.0.0"));
		assert!(!is_newer("1.0", "0.9.0"));
		assert!(!is_newer("2.0.0", ""));
		assert!(!is_newer("1.0.0.1", "1.0.0"));
	}
}
