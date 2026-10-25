// Finding what there is to clean up in a finished scan tree, below the
// folder the user is in: by name, or with one of the finders, which look for
// the kinds of things people clear off a disk (big files, things untouched
// for a year, build output, caches…).
//
// A match is always the outermost one: a folder that matches stands for
// everything in it, so nothing is counted twice, and every hit is something
// that can go whole. Packages (an app, a Photos library) are one item, as the
// Finder shows them, so nothing here suggests taking a piece out of one.

use crate::tree::walk_to_cursor;
use crate::{Tree, VfsNode};
use serde::{Deserialize, Serialize};
use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use string_interner::Symbol;

// Matches that come back with paths; the rest are only counted.
const MATCH_CAP: usize = 500;
// Where the large files finder starts.
const LARGE: u64 = 100_000_000;
// How long something has to sit untouched for the old finder.
const YEAR: u32 = 365 * 24 * 60 * 60;

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Finder {
	/// Files of `LARGE` or more.
	Large,
	/// Files and folders nothing in has changed for a year.
	Old,
	Videos,
	Archives,
	/// Disk images and installers, often left behind once they've done
	/// their job.
	Installers,
	/// What developer tools make, and make again when it's gone:
	/// node_modules, Rust's target, Xcode's DerivedData…
	Developer,
	Caches,
}

impl Finder {
	pub const ALL: [Finder; 7] = [
		Finder::Large,
		Finder::Old,
		Finder::Videos,
		Finder::Archives,
		Finder::Installers,
		Finder::Developer,
		Finder::Caches,
	];
}

/// `{ "name": "…" }` or `{ "finder": "…" }`, as `Ob.FindQuery` has it.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Query {
	/// Names that contain this, ignoring case.
	Name(String),
	Finder(Finder),
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Match {
	pub path: String,
	/// The folders between the one searched and the match.
	pub within: Vec<String>,
	pub size: u64,
	#[serde(rename = "type")]
	pub kind: &'static str,
	/// When anything in it last changed, in milliseconds since 1970.
	pub modified: u64,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Found {
	/// The largest matches, largest first; ties keep scan order.
	pub matches: Vec<Match>,
	pub total_count: u64,
	pub total_size: u64,
	pub truncated: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Summary {
	pub finder: Finder,
	pub count: u64,
	pub size: u64,
}

/// Everything below the folder at `cursor` that `query` matches. Paths start
/// at `base_path`, the scan root's. None if `cursor` doesn't lead to a
/// folder.
pub fn find(tree: &Tree, base_path: &str, cursor: &[String], query: &Query) -> Option<Found> {
	find_at(tree, base_path, cursor, query, now())
}

/// How much each finder finds below the folder at `cursor`, in a scan of
/// `base_path`. None if `cursor` doesn't lead to a folder.
pub fn summarize(tree: &Tree, base_path: &str, cursor: &[String]) -> Option<Vec<Summary>> {
	summarize_at(tree, base_path, cursor, now())
}

fn find_at(
	tree: &Tree,
	base_path: &str,
	cursor: &[String],
	query: &Query,
	now: u32,
) -> Option<Found> {
	let (scope, _) = walk_to_cursor(tree, cursor)?;
	let (kind, needle) = match query {
		Query::Name(text) => {
			let needle = text.trim().to_lowercase();
			if needle.is_empty() {
				return Some(Found::default());
			}
			(Kind::Name, Some(needle))
		}
		Query::Finder(finder) => (Kind::Finder(*finder), None),
	};
	let mut base = PathBuf::from(base_path);
	base.extend(cursor);
	let mut walk = Walk::new(tree, scope, vec![kind], needle.as_deref(), now);
	walk.hits = Some(Hits {
		base,
		top: BinaryHeap::new(),
	});
	walk.run(scope, in_app_data(base_path, cursor));
	let hits = walk.hits.take()?;
	let total_count = walk.counts[0];
	Some(Found {
		matches: hits
			.top
			.into_sorted_vec()
			.into_iter()
			.map(|Reverse(hit)| hit.found)
			.collect(),
		truncated: total_count > MATCH_CAP as u64,
		total_count,
		total_size: walk.sizes[0],
	})
}

fn summarize_at(tree: &Tree, base_path: &str, cursor: &[String], now: u32) -> Option<Vec<Summary>> {
	let (scope, _) = walk_to_cursor(tree, cursor)?;
	let kinds = Finder::ALL.iter().map(|&f| Kind::Finder(f)).collect();
	let mut walk = Walk::new(tree, scope, kinds, None, now);
	walk.run(scope, in_app_data(base_path, cursor));
	Some(
		Finder::ALL
			.iter()
			.enumerate()
			.map(|(i, &finder)| Summary {
				finder,
				count: walk.counts[i],
				size: walk.sizes[i],
			})
			.collect(),
	)
}

fn now() -> u32 {
	let since = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default();
	u32::try_from(since.as_secs()).unwrap_or(u32::MAX)
}

#[derive(Clone, Copy)]
enum Kind {
	Name,
	Finder(Finder),
}

// What a name says about whatever has it, worked out once per name rather
// than once per node that has it.
const MATCHES_QUERY: u32 = 1 << 0;
const VIDEO: u32 = 1 << 1;
const ARCHIVE: u32 = 1 << 2;
const INSTALLER: u32 = 1 << 3;
// A folder the Finder shows as one file.
const PACKAGE: u32 = 1 << 4;
const BUILD_OUTPUT: u32 = 1 << 5;
const CACHE: u32 = 1 << 6;
// Build output only beside the file that says so, since the names are
// too common to go on alone.
const TARGET: u32 = 1 << 7;
const CARGO_TOML: u32 = 1 << 8;
const DOT_BUILD: u32 = 1 << 9;
const PACKAGE_SWIFT: u32 = 1 << 10;
const BUILD: u32 = 1 << 11;
const BUILD_GRADLE: u32 = 1 << 12;
// What makes any folder a Python virtual environment.
const PYVENV_CFG: u32 = 1 << 13;
// Windows' AppData\Local\Temp.
const TEMP: u32 = 1 << 14;
const LOCAL: u32 = 1 << 15;
// Where apps keep their data: a hidden folder, ~/Library, AppData… A folder
// in one called just "cache" is one; elsewhere it's as likely to be code.
const APP_DATA: u32 = 1 << 16;
const GENERIC_CACHE: u32 = 1 << 17;
// A repository's history, which nothing's found in: none of it is any use
// without the rest.
const VCS: u32 = 1 << 18;
// Not a name's: passed down with a folder's flags to what's below one with
// APP_DATA.
const IN_APP_DATA: u32 = 1 << 19;

const VIDEOS: &[&str] = &[
	// Not "mts", which is TypeScript's as much as a camera's.
	"3gp", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "vob", "webm", "wmv",
];
const ARCHIVES: &[&str] = &[
	"7z", "bz2", "cab", "gz", "lz4", "lzma", "rar", "tar", "tbz2", "tgz", "txz", "xz", "zip", "zst",
];
const INSTALLERS: &[&str] = &[
	"appimage",
	"deb",
	"dmg",
	"img",
	"ipsw",
	"iso",
	"mpkg",
	"msi",
	"msix",
	"pkg",
	"qcow2",
	"rpm",
	"sparsebundle",
	"sparseimage",
	"vdi",
	"vhd",
	"vhdx",
	"vmdk",
	"xip",
];
const PACKAGES: &[&str] = &[
	"app",
	"aplibrary",
	"band",
	"bundle",
	"fcpbundle",
	"framework",
	"imovielibrary",
	"key",
	"logicx",
	"mpkg",
	"musiclibrary",
	"numbers",
	"pages",
	"photoslibrary",
	"pkg",
	"plugin",
	"rtfd",
	"sparsebundle",
	"tvlibrary",
	"xcarchive",
];
const BUILD_OUTPUTS: &[&str] = &[
	".angular",
	".dart_tool",
	".gradle",
	".mypy_cache",
	".next",
	".nuxt",
	".parcel-cache",
	".pnpm-store",
	".pytest_cache",
	".ruff_cache",
	".svelte-kit",
	".terraform",
	".tox",
	".turbo",
	".venv",
	"DerivedData",
	"Pods",
	"__pycache__",
	"bower_components",
	"iOS DeviceSupport",
	"node_modules",
	"tvOS DeviceSupport",
	"visionOS DeviceSupport",
	"watchOS DeviceSupport",
];
// Compared ignoring case.
const CACHES: &[&str] = &[
	".cache",
	"_cacache",
	"cache2",
	"cacheddata",
	"code cache",
	"dawncache",
	"gpucache",
	"grshadercache",
	"inetcache",
	"shadercache",
];

fn name_flags(name: &str, needle: Option<&str>) -> u32 {
	let mut flags = 0;
	if needle.is_some_and(|needle| contains_folded(name, needle)) {
		flags |= MATCHES_QUERY;
	}
	// No allocating per name: the lists are ASCII.
	let is_any = |text: &str, list: &[&str]| list.iter().any(|e| text.eq_ignore_ascii_case(e));
	if let Some((_, extension)) = name.rsplit_once('.') {
		for (list, flag) in [
			(VIDEOS, VIDEO),
			(ARCHIVES, ARCHIVE),
			(INSTALLERS, INSTALLER),
			(PACKAGES, PACKAGE),
		] {
			if is_any(extension, list) {
				flags |= flag;
			}
		}
	}
	if BUILD_OUTPUTS.contains(&name) {
		flags |= BUILD_OUTPUT;
	}
	if is_any(name, CACHES) {
		flags |= CACHE;
	}
	if is_any(name, &["cache", "caches"]) {
		flags |= GENERIC_CACHE;
	}
	if is_app_data(name) {
		flags |= APP_DATA;
	}
	flags |= match name {
		"target" => TARGET,
		"Cargo.toml" => CARGO_TOML,
		".build" => DOT_BUILD,
		"Package.swift" => PACKAGE_SWIFT,
		"build" => BUILD,
		"build.gradle" | "build.gradle.kts" => BUILD_GRADLE,
		"pyvenv.cfg" => PYVENV_CFG,
		".git" | ".hg" | ".svn" => VCS,
		_ => 0,
	};
	if name.eq_ignore_ascii_case("temp") {
		flags |= TEMP;
	}
	if name.eq_ignore_ascii_case("local") {
		flags |= LOCAL;
	}
	flags
}

fn is_app_data(name: &str) -> bool {
	name.starts_with('.')
		|| name == "Library"
		|| name == "var"
		|| name.eq_ignore_ascii_case("AppData")
		|| name.eq_ignore_ascii_case("ProgramData")
}

// Whether the folder at `cursor` in a scan of `base_path` is in, or is,
// somewhere apps keep their data, which the tree can't say for what's above
// its root.
fn in_app_data(base_path: &str, cursor: &[String]) -> bool {
	Path::new(base_path)
		.components()
		.filter_map(|part| match part {
			Component::Normal(name) => name.to_str(),
			_ => None,
		})
		.chain(cursor.iter().map(String::as_str))
		.any(is_app_data)
}

// One pass over the folder searched, counting what each kind matches.
struct Walk<'a> {
	tree: &'a Tree,
	kinds: Vec<Kind>,
	// The kinds that are finders, and those of them that go by what a file
	// is, as bits for `covered`.
	finders: u64,
	by_type: u64,
	flags: Vec<u32>,
	now: u32,
	// Anything that last changed before this is old.
	cutoff: u32,
	// When anything in each folder last changed, and where the folders
	// after it start, in the order the walk meets them (`last_changed`).
	folders: Vec<(u32, usize)>,
	next_folder: usize,
	counts: Vec<u64>,
	sizes: Vec<u64>,
	// Names from just below the folder searched down to the node visited.
	stack: Vec<&'a str>,
	// Collected for the first kind, when there are hits to show.
	hits: Option<Hits>,
}

struct Hits {
	base: PathBuf,
	// The best so far, worst on top so it's the one to evict.
	top: BinaryHeap<Reverse<Hit>>,
}

impl<'a> Walk<'a> {
	fn new(
		tree: &'a Tree,
		scope: &'a VfsNode,
		kinds: Vec<Kind>,
		needle: Option<&str>,
		now: u32,
	) -> Self {
		let mut flags = vec![0; tree.names.len()];
		for (name, text) in &tree.names {
			flags[name.to_usize()] = name_flags(text, needle);
		}
		let mut folders = Vec::new();
		last_changed(scope, &mut folders);
		let count = kinds.len();
		let mask = |pick: fn(Kind) -> bool| {
			(kinds.iter().enumerate())
				.filter(|&(_, &kind)| pick(kind))
				.fold(0, |mask, (i, _)| mask | 1 << i)
		};
		Walk {
			tree,
			finders: mask(|kind| matches!(kind, Kind::Finder(_))),
			by_type: mask(|kind| {
				matches!(
					kind,
					Kind::Finder(
						Finder::Videos | Finder::Archives | Finder::Installers | Finder::Caches
					)
				)
			}),
			kinds,
			flags,
			now,
			cutoff: now.saturating_sub(YEAR),
			folders,
			next_folder: 0,
			counts: vec![0; count],
			sizes: vec![0; count],
			stack: Vec::new(),
			hits: None,
		}
	}

	// `app_data` is whether the folder searched is somewhere apps keep their
	// data (`in_app_data`).
	fn run(&mut self, scope: &'a VfsNode, app_data: bool) {
		let VfsNode::Directory { files, .. } = scope else {
			return;
		};
		// The folder searched is never a match itself, only what's in it.
		self.next_folder = 1;
		let siblings = self.flags_of(files);
		let mut parent = self.flags[scope.name().to_usize()];
		if app_data {
			parent |= IN_APP_DATA;
		}
		for child in files {
			self.visit(child, siblings, parent, 0);
		}
	}

	// `siblings` is every flag among the node and its siblings, `parent` the
	// folder's own (with IN_APP_DATA), and `covered` the kinds matched, or
	// ruled out, further up.
	fn visit(&mut self, node: &'a VfsNode, siblings: u32, parent: u32, mut covered: u64) {
		let flags = self.flags[node.name().to_usize()];
		let (files, changed, end) = match node {
			VfsNode::Directory { files, .. } => {
				let (changed, end) = self.folders[self.next_folder];
				self.next_folder += 1;
				(Some(files), changed, end)
			}
			VfsNode::File { .. } => (None, known(node.mtime()), self.next_folder),
		};
		let inside = files.map_or(0, |files| self.flags_of(files));
		let folder = files.is_some();
		let package = folder && flags & PACKAGE != 0;
		let unit = !folder || package;
		let developer = folder
			&& (flags & BUILD_OUTPUT != 0
				|| (flags & TARGET != 0 && siblings & CARGO_TOML != 0)
				|| (flags & DOT_BUILD != 0 && siblings & PACKAGE_SWIFT != 0)
				|| (flags & BUILD != 0 && siblings & BUILD_GRADLE != 0)
				|| inside & PYVENV_CFG != 0);
		let cache = folder
			&& (flags & CACHE != 0
				|| (flags & GENERIC_CACHE != 0 && parent & IN_APP_DATA != 0)
				|| (flags & TEMP != 0 && parent & LOCAL != 0));
		if folder && flags & VCS != 0 {
			covered |= self.finders;
		}
		self.stack.push(self.tree.name(node));
		for i in 0..self.kinds.len() {
			if covered & (1 << i) != 0 {
				continue;
			}
			let size = node.size();
			let matched = match self.kinds[i] {
				Kind::Name => flags & MATCHES_QUERY != 0,
				Kind::Finder(finder) => {
					size > 0
						&& match finder {
							Finder::Large => unit && size >= LARGE,
							Finder::Old => changed < self.cutoff,
							Finder::Videos => unit && flags & VIDEO != 0,
							Finder::Archives => unit && flags & ARCHIVE != 0,
							Finder::Installers => unit && flags & INSTALLER != 0,
							Finder::Developer => developer,
							Finder::Caches => cache,
						}
				}
			};
			if matched {
				covered |= 1 << i;
				self.counts[i] += 1;
				self.sizes[i] += size;
				if i == 0 {
					self.offer(node, changed);
				}
			}
		}
		// Nothing in a package is offered on its own. What's in build output
		// goes with it, so it's no video or cache of its own either.
		let all = (1 << self.kinds.len()) - 1;
		if package {
			covered = all;
		} else if developer {
			covered |= self.by_type;
		}
		match files {
			Some(_) if covered == all => self.next_folder = end,
			Some(files) => {
				let mut below = flags | parent & IN_APP_DATA;
				if flags & APP_DATA != 0 {
					below |= IN_APP_DATA;
				}
				for child in files.iter() {
					self.visit(child, inside, below, covered);
				}
			}
			None => {}
		}
		self.stack.pop();
	}

	fn flags_of(&self, files: &[VfsNode]) -> u32 {
		files
			.iter()
			.fold(0, |all, f| all | self.flags[f.name().to_usize()])
	}

	// Keeps the hit if it's among the largest so far. The path is only
	// built once it's in, since most hits on a broad query aren't.
	fn offer(&mut self, node: &VfsNode, changed: u32) {
		let Some(hits) = self.hits.as_mut() else {
			return;
		};
		let rank = (node.size(), Reverse(self.counts[0]));
		if hits.top.len() == MATCH_CAP {
			match hits.top.peek() {
				Some(Reverse(worst)) if rank > worst.rank => {
					hits.top.pop();
				}
				_ => return,
			}
		}
		let mut path = hits.base.clone();
		path.extend(&self.stack);
		let within = &self.stack[..self.stack.len() - 1];
		hits.top.push(Reverse(Hit {
			rank,
			found: Match {
				path: path.to_string_lossy().into_owned(),
				within: within.iter().map(|&name| name.to_owned()).collect(),
				size: node.size(),
				kind: match node {
					VfsNode::Directory { .. } => "directory",
					VfsNode::File { .. } => "file",
				},
				// Unknown comes out as "now" rather than 1970.
				modified: u64::from(changed.min(self.now)) * 1000,
			},
		}));
	}
}

// When anything in `node` last changed, its own mtime included. Folders are
// numbered in the order the walk meets them, each with the number of the
// first one after it, so the walk can step over one it doesn't go into.
fn last_changed(node: &VfsNode, folders: &mut Vec<(u32, usize)>) -> u32 {
	let VfsNode::Directory { files, .. } = node else {
		return known(node.mtime());
	};
	let at = folders.len();
	folders.push((0, 0));
	let changed = files
		.iter()
		.map(|f| last_changed(f, folders))
		.fold(known(node.mtime()), u32::max);
	folders[at] = (changed, folders.len());
	changed
}

// An mtime the scan couldn't read is 0, which counts as recent, so that
// nothing is called old for want of knowing.
fn known(mtime: u32) -> u32 {
	if mtime == 0 { u32::MAX } else { mtime }
}

// Ordered by `rank` alone: size, then earlier in the scan.
struct Hit {
	rank: (u64, Reverse<u64>),
	found: Match,
}

impl Ord for Hit {
	fn cmp(&self, other: &Self) -> Ordering {
		self.rank.cmp(&other.rank)
	}
}

impl PartialOrd for Hit {
	fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
		Some(self.cmp(other))
	}
}

impl PartialEq for Hit {
	fn eq(&self, other: &Self) -> bool {
		self.rank == other.rank
	}
}

impl Eq for Hit {}

// Whether `name`, lowercased, contains `needle` (already lowercase). Most
// names are ASCII, and those are compared in place rather than lowercased
// into a new string per name.
fn contains_folded(name: &str, needle: &str) -> bool {
	if name.is_ascii() {
		let (name, needle) = (name.as_bytes(), needle.as_bytes());
		return name.len() >= needle.len()
			&& name
				.windows(needle.len())
				.any(|w| w.eq_ignore_ascii_case(needle));
	}
	name.to_lowercase().contains(needle)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::JsonNode;

	// 2026-01-01, and what's a year and a bit before it.
	const NOW: u32 = 1_767_225_600;
	const LONG_AGO: u32 = NOW - YEAR - 86_400;

	fn file(name: &str, size: u64) -> JsonNode {
		changed(name, size, NOW)
	}

	fn changed(name: &str, size: u64, at: u32) -> JsonNode {
		JsonNode::File {
			name: name.into(),
			size,
			mtime: u64::from(at) * 1000,
		}
	}

	fn dir(name: &str, files: Vec<JsonNode>) -> JsonNode {
		dir_changed(name, files, NOW)
	}

	fn dir_changed(name: &str, files: Vec<JsonNode>, at: u32) -> JsonNode {
		JsonNode::Directory {
			name: name.into(),
			size: files
				.iter()
				.map(|f| match f {
					JsonNode::Directory { size, .. } | JsonNode::File { size, .. } => size,
				})
				.sum(),
			mtime: u64::from(at) * 1000,
			files,
		}
	}

	fn cursor(parts: &[&str]) -> Vec<String> {
		parts.iter().map(|p| p.to_string()).collect()
	}

	// A path as find spells it, with the platform's separators.
	fn at(parts: &[&str]) -> String {
		parts
			.iter()
			.collect::<PathBuf>()
			.to_string_lossy()
			.into_owned()
	}

	fn named(tree: &Tree, cursor: &[String], text: &str) -> Found {
		find_at(tree, "/base", cursor, &Query::Name(text.into()), NOW).unwrap()
	}

	fn found(tree: &Tree, finder: Finder) -> Vec<String> {
		find_at(tree, "/", &[], &Query::Finder(finder), NOW)
			.unwrap()
			.matches
			.into_iter()
			.map(|m| m.path)
			.collect()
	}

	fn photos() -> Tree {
		Tree::from(dir(
			"root",
			vec![
				dir(
					"Photos",
					vec![file("photo-1.jpg", 300), file("notes.txt", 5)],
				),
				file("PHOTO-2.JPG", 200),
				dir("other", vec![file("Ünïcode Photo.png", 100)]),
			],
		))
	}

	#[test]
	fn names_match_ignoring_case_and_only_the_outermost_counts() {
		let found = named(&photos(), &[], "  photo ");
		let paths: Vec<_> = found.matches.iter().map(|m| m.path.as_str()).collect();
		assert_eq!(
			paths,
			[
				at(&["/base", "Photos"]),
				at(&["/base", "PHOTO-2.JPG"]),
				at(&["/base", "other", "Ünïcode Photo.png"]),
			]
		);
		assert_eq!(found.matches[0].kind, "directory");
		assert_eq!(found.matches[1].kind, "file");
		assert_eq!(found.matches[2].within, ["other"]);
		assert_eq!(found.total_count, 3);
		assert_eq!(found.total_size, 305 + 200 + 100);
		assert!(!found.truncated);
	}

	#[test]
	fn names_fold_case_beyond_ascii() {
		let found = named(&photos(), &[], "ÜNÏ");
		assert_eq!(
			found.matches[0].path,
			at(&["/base", "other", "Ünïcode Photo.png"])
		);
	}

	#[test]
	fn an_empty_name_matches_nothing() {
		let found = named(&photos(), &[], "   ");
		assert!(found.matches.is_empty());
		assert_eq!(found.total_count, 0);
	}

	#[test]
	fn only_whats_in_the_folder_at_the_cursor_is_found() {
		let tree = Tree::from(dir(
			"root",
			vec![
				dir("a", vec![dir("b", vec![file("match", 5)])]),
				file("match", 10),
			],
		));
		let found = named(&tree, &cursor(&["a"]), "match");
		assert_eq!(found.total_count, 1);
		assert_eq!(found.matches[0].path, at(&["/base", "a", "b", "match"]));
		assert_eq!(found.matches[0].within, ["b"]);
	}

	#[test]
	fn the_folder_searched_is_not_a_match_itself() {
		let tree = Tree::from(dir("root", vec![dir(".cache", vec![file("x", 5)])]));
		let caches = |cursor: &[String]| {
			find_at(&tree, "/", cursor, &Query::Finder(Finder::Caches), NOW)
				.unwrap()
				.total_count
		};
		assert_eq!(caches(&[]), 1);
		assert_eq!(caches(&cursor(&[".cache"])), 0);
	}

	#[test]
	fn nothing_for_a_cursor_that_leads_nowhere() {
		assert!(
			find_at(
				&photos(),
				"/",
				&cursor(&["nope"]),
				&Query::Name("x".into()),
				NOW
			)
			.is_none()
		);
		assert!(summarize_at(&photos(), "/", &cursor(&["PHOTO-2.JPG"]), NOW).is_none());
	}

	#[test]
	fn keeps_the_largest_matches_and_counts_the_rest() {
		let files = (1..=600).map(|i| file(&format!("f{i}"), i)).collect();
		let found = named(&Tree::from(dir("root", files)), &[], "f");
		assert_eq!(found.matches.len(), MATCH_CAP);
		assert!(found.truncated);
		assert_eq!(found.total_count, 600);
		assert_eq!(found.total_size, (1..=600).sum::<u64>());
		assert_eq!(found.matches.first().unwrap().size, 600);
		assert_eq!(found.matches.last().unwrap().size, 101);
	}

	#[test]
	fn ties_keep_scan_order() {
		let files = (0..MATCH_CAP + 10)
			.map(|i| file(&format!("f{i}"), 7))
			.collect();
		let found = named(&Tree::from(dir("root", files)), &[], "f");
		assert_eq!(found.matches[0].path, at(&["/base", "f0"]));
		assert_eq!(
			found.matches.last().unwrap().path,
			at(&["/base", &format!("f{}", MATCH_CAP - 1)])
		);
	}

	fn disk() -> Tree {
		Tree::from(dir(
			"root",
			vec![
				dir(
					"project",
					vec![
						file("Cargo.toml", 1),
						dir("target", vec![file("app", 50)]),
						dir(
							"node_modules",
							vec![dir("x", vec![dir("node_modules", vec![file("y", 5)])])],
						),
					],
				),
				// Not Rust's: there's no Cargo.toml beside it.
				dir("notes", vec![dir("target", vec![file("goals.txt", 3)])]),
				dir(
					"env",
					vec![file("pyvenv.cfg", 1), dir("lib", vec![file("six.py", 9)])],
				),
				dir(
					"ios",
					vec![file("Package.swift", 1), dir(".build", vec![file("o", 4)])],
				),
				file("movie.MOV", 200_000_000),
				file("clip.mp4", 2_000),
				file("backup.tar.gz", 30),
				file("Installer.dmg", 70),
				dir(
					"Photos Library.photoslibrary",
					vec![dir("originals", vec![file("big.mov", 150_000_000)])],
				),
				dir(
					"Xcode.app",
					vec![dir("Contents", vec![file("bundled.zip", 8)])],
				),
				dir("Library", vec![dir("Caches", vec![file("blob", 12)])]),
				dir(
					"AppData",
					vec![dir("Local", vec![dir("Temp", vec![file("t", 6)])])],
				),
				dir("Temp", vec![file("mine", 2)]),
			],
		))
	}

	#[test]
	fn finders_find_what_they_say() {
		let tree = disk();
		assert_eq!(
			found(&tree, Finder::Large),
			[
				at(&["/", "movie.MOV"]),
				at(&["/", "Photos Library.photoslibrary"])
			]
		);
		assert_eq!(
			found(&tree, Finder::Videos),
			[at(&["/", "movie.MOV"]), at(&["/", "clip.mp4"])]
		);
		assert_eq!(
			found(&tree, Finder::Archives),
			[at(&["/", "backup.tar.gz"])]
		);
		assert_eq!(
			found(&tree, Finder::Installers),
			[at(&["/", "Installer.dmg"])]
		);
		assert_eq!(
			found(&tree, Finder::Developer),
			[
				at(&["/", "project", "target"]),
				at(&["/", "env"]),
				at(&["/", "project", "node_modules"]),
				at(&["/", "ios", ".build"]),
			]
		);
		assert_eq!(
			found(&tree, Finder::Caches),
			[
				at(&["/", "Library", "Caches"]),
				at(&["/", "AppData", "Local", "Temp"]),
			]
		);
	}

	#[test]
	fn summaries_count_what_each_finder_finds() {
		let summaries = summarize_at(&disk(), "/", &[], NOW).unwrap();
		let of = |finder| {
			summaries
				.iter()
				.find(|s| s.finder == finder)
				.map(|s| (s.count, s.size))
				.unwrap()
		};
		assert_eq!(summaries.len(), Finder::ALL.len());
		assert_eq!(of(Finder::Large), (2, 350_000_000));
		assert_eq!(of(Finder::Videos), (2, 200_002_000));
		assert_eq!(of(Finder::Developer), (4, 50 + 10 + 5 + 4));
		assert_eq!(of(Finder::Caches), (2, 18));
		assert_eq!(of(Finder::Old), (0, 0));
	}

	#[test]
	fn old_is_what_nothing_in_has_changed_for_a_year() {
		let tree = Tree::from(dir(
			"root",
			vec![
				dir_changed(
					"old project",
					vec![
						changed("a", 10, LONG_AGO),
						dir_changed("b", vec![changed("c", 5, LONG_AGO)], LONG_AGO),
					],
					LONG_AGO,
				),
				// Changed lately, but there's something old in it.
				dir_changed(
					"mixed",
					vec![changed("old", 7, LONG_AGO), changed("new", 3, NOW)],
					LONG_AGO,
				),
				// A scan that couldn't read when it changed doesn't call it old.
				changed("unknown", 9, 0),
				changed("empty", 0, LONG_AGO),
			],
		));
		assert_eq!(
			found(&tree, Finder::Old),
			[at(&["/", "old project"]), at(&["/", "mixed", "old"])]
		);
		let found = find_at(&tree, "/", &[], &Query::Finder(Finder::Old), NOW).unwrap();
		assert_eq!(found.total_size, 15 + 7);
		assert_eq!(found.matches[0].modified, u64::from(LONG_AGO) * 1000);
	}

	#[test]
	fn modified_is_when_anything_inside_last_changed() {
		let tree = Tree::from(dir(
			"root",
			vec![dir_changed(
				"photos",
				vec![changed("new.jpg", 5, NOW - 60)],
				LONG_AGO,
			)],
		));
		let found = named(&tree, &[], "photos");
		assert_eq!(found.matches[0].modified, u64::from(NOW - 60) * 1000);
	}

	#[test]
	fn history_and_build_output_are_left_to_themselves() {
		let tree = Tree::from(dir(
			"root",
			vec![dir(
				"repo",
				vec![
					dir(
						".git",
						vec![
							dir("pack", vec![file("big.pack", LARGE)]),
							changed("ORIG_HEAD", 1, LONG_AGO),
						],
					),
					dir(
						"node_modules",
						vec![
							dir("pkg", vec![file("fixture.zip", 3), file("clip.mp4", 4)]),
							dir(".cache", vec![file("babel", 5)]),
						],
					),
					file("main.rs", 6),
				],
			)],
		));
		for finder in [
			Finder::Large,
			Finder::Old,
			Finder::Videos,
			Finder::Archives,
			Finder::Caches,
		] {
			assert!(found(&tree, finder).is_empty(), "{finder:?}");
		}
		assert_eq!(
			found(&tree, Finder::Developer),
			[at(&["/", "repo", "node_modules"])]
		);
		// It's only finders that leave history alone.
		let named = named(&tree, &[], "pack");
		assert_eq!(
			named.matches[0].path,
			at(&["/base", "repo", ".git", "pack"])
		);
	}

	#[test]
	fn a_folder_called_cache_is_one_only_where_apps_keep_data() {
		let tree = Tree::from(dir(
			"root",
			vec![
				dir(
					"project",
					vec![dir("src", vec![dir("cache", vec![file("lru.rs", 1)])])],
				),
				dir(".yarn", vec![dir("cache", vec![file("react.zip", 2)])]),
				dir(
					"Library",
					vec![dir(
						"Application Support",
						vec![dir("Code", vec![dir("Cache", vec![file("data", 3)])])],
					)],
				),
			],
		));
		assert_eq!(
			found(&tree, Finder::Caches),
			[
				at(&["/", "Library", "Application Support", "Code", "Cache"]),
				at(&["/", ".yarn", "cache"]),
			]
		);
		// What's above the folder searched counts too, in the tree or not.
		let caches = |base_path: &str, cursor: &[String]| {
			summarize_at(&tree, base_path, cursor, NOW)
				.unwrap()
				.into_iter()
				.find(|s| s.finder == Finder::Caches)
				.unwrap()
				.count
		};
		assert_eq!(caches("/", &cursor(&["Library", "Application Support"])), 1);
		assert_eq!(caches("/Users/me", &cursor(&["project", "src"])), 0);
		assert_eq!(caches("/Users/me/.local", &cursor(&["project", "src"])), 1);
	}
}
