// Paths here are written the way the platform writes them, as the scanner's
// search does: Windows puts "\" between names and takes "/" too. Everywhere
// else "/" is the only separator, and "\" is a character a name can have.

use std::collections::HashSet;

fn is_separator(c: char) -> bool {
	c == '/' || (cfg!(windows) && c == '\\')
}

// `path` without the separators it ends with.
fn trim_end(path: &str) -> &str {
	path.trim_end_matches(is_separator)
}

// `names` inside `base`: "C:\" and "Users" are "C:\Users" on Windows, and "/"
// and "Users" are "/Users" everywhere else.
pub fn join_path<S: AsRef<str>>(base: &str, names: impl IntoIterator<Item = S>) -> String {
	let mut path = String::new();
	for name in names {
		let name = name.as_ref();
		if name.is_empty() {
			continue;
		}
		if path.is_empty() {
			path.push_str(trim_end(base));
		}
		path.push(if cfg!(windows) { '\\' } else { '/' });
		path.push_str(name);
	}
	if path.is_empty() {
		base.to_string()
	} else {
		path
	}
}

// Last path segment, tolerant of trailing separators. A bare root ("/") is
// its own name.
pub fn basename(path: &str) -> &str {
	let trimmed = match trim_end(path) {
		"" => path,
		trimmed => trimmed,
	};
	match trimmed.rfind(is_separator) {
		Some(at) if at + 1 < trimmed.len() => &trimmed[at + 1..],
		_ => trimmed,
	}
}

// Whether `path` is one of `paths`, or inside one of them.
pub fn is_within(path: &str, paths: &HashSet<String>) -> bool {
	if paths.is_empty() {
		return false;
	}
	let mut end = path.len();
	while end > 0 {
		if paths.contains(&path[..end]) {
			return true;
		}
		end = path[..end].rfind(is_separator).unwrap_or(0);
	}
	false
}

// The names leading from `root` down to `target`; empty if `target` is
// `root` itself or isn't inside it.
pub fn parts_below(root: &str, target: &str) -> Vec<String> {
	let Some(rest) = target.strip_prefix(root) else {
		return Vec::new();
	};
	// "/a/bc" isn't inside "/a/b", though anything is inside "/" or "C:\".
	if !rest.starts_with(is_separator) && !root.ends_with(is_separator) {
		return Vec::new();
	}
	rest.split(is_separator)
		.filter(|name| !name.is_empty())
		.map(str::to_string)
		.collect()
}

#[cfg(all(test, not(windows)))]
mod tests {
	use super::*;

	#[test]
	fn joins() {
		assert_eq!(join_path("/", ["Users"]), "/Users");
		assert_eq!(join_path("/Users/", ["a", "", "b"]), "/Users/a/b");
		assert_eq!(join_path("/Users", Vec::<String>::new()), "/Users");
	}

	#[test]
	fn names() {
		assert_eq!(basename("/Users/alice/Movies"), "Movies");
		assert_eq!(basename("/Users/alice/"), "alice");
		assert_eq!(basename("/"), "/");
		assert_eq!(basename("Movies"), "Movies");
	}

	#[test]
	fn within() {
		let paths = HashSet::from(["/a/b".to_string()]);
		assert!(is_within("/a/b", &paths));
		assert!(is_within("/a/b/c/d", &paths));
		assert!(!is_within("/a/bc", &paths));
		assert!(!is_within("/a", &paths));
	}

	#[test]
	fn below() {
		assert_eq!(parts_below("/a/b", "/a/b/c/d"), ["c", "d"]);
		assert_eq!(parts_below("/", "/a/b"), ["a", "b"]);
		assert!(parts_below("/a/b", "/a/bc").is_empty());
		assert!(parts_below("/a/b", "/a/b").is_empty());
	}
}
