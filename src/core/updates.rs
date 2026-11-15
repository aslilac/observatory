// New versions: finding out there's one, and on macOS, putting it in place.
//
// The releases are in a bucket, with a `latest.json` that says which is the
// newest; if the bucket can't be reached, GitHub's list of the releases says
// the same. Everywhere, that's enough to say "Version 1.2.0 is out".
//
// On macOS the app can go further and replace itself: it downloads the new
// app, checks it's signed by the same team as the copy that's running, and
// swaps the two when the user says to restart. An app that isn't signed
// with a certificate (an ad hoc build) has no team to check against, so it
// only ever says there's a new version. On Windows the Store does the
// updating, and on Linux Flatpak does.

use crate::version::is_newer;
use serde_json::Value;
use std::io::{self, Read};
use std::time::Duration;

/// Where the newest release is named. `OBSERVATORY_UPDATE_FEED` points the
/// app somewhere else, for trying an update out.
const FEED: &str = "https://releases.mckayla.dev/observatory/latest.json";
const GITHUB: &str = "https://api.github.com/repos/aslilac/observatory/releases?per_page=10";

// Nothing the app asks for is anywhere near this big, the app itself
// included.
const LARGEST: u64 = 512 * 1024 * 1024;

/// A release that's out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
	pub version: String,
	/// Its page, to read about it and download it by hand.
	pub page: String,
	/// The build of it for this platform that the app can install by
	/// itself, where there is one.
	pub download: Option<String>,
}

/// What a build for this platform is listed under, in `latest.json`'s
/// `downloads`, where the app can install one itself.
fn platform() -> Option<&'static str> {
	cfg!(all(target_os = "macos", target_arch = "aarch64")).then_some("darwin-arm64")
}

// What the release's build for this platform is called, among a GitHub
// release's files (see macos/build.sh).
fn asset_name(version: &str) -> Option<String> {
	Some(format!("Observatory-{}-{version}.zip", platform()?))
}

// `latest.json`: `{ "version", "url", "downloads": { "<platform>": "<url>" } }`.
fn from_feed(json: &[u8]) -> Option<Release> {
	let feed: Value = serde_json::from_slice(json).ok()?;
	let download = platform()
		.and_then(|platform| feed.get("downloads")?.get(platform)?.as_str())
		.map(str::to_string);
	Some(Release {
		version: feed.get("version")?.as_str()?.to_string(),
		page: feed.get("url")?.as_str()?.to_string(),
		download,
	})
}

// GitHub's list of the releases, newest first. Prereleases count, as they do
// in the bucket; drafts aren't out yet.
fn from_github(json: &[u8]) -> Option<Release> {
	let releases: Value = serde_json::from_slice(json).ok()?;
	let release = releases
		.as_array()?
		.iter()
		.find(|release| release.get("draft").and_then(Value::as_bool) != Some(true))?;
	let tag = release.get("tag_name")?.as_str()?;
	let version = tag.strip_prefix('v').unwrap_or(tag).to_string();
	let wanted = asset_name(&version);
	let download = release
		.get("assets")
		.and_then(Value::as_array)
		.and_then(|assets| {
			assets.iter().find_map(|asset| {
				let name = asset.get("name")?.as_str()?;
				(Some(name) == wanted.as_deref())
					.then(|| asset.get("browser_download_url")?.as_str())
					.flatten()
			})
		})
		.map(str::to_string);
	Some(Release {
		version,
		page: release.get("html_url")?.as_str()?.to_string(),
		download,
	})
}

/// The newest release, if it's newer than `current`. `fetch` gets what's at
/// a URL (`fetch` here does, over the network).
pub fn check(current: &str, fetch: impl Fn(&str) -> io::Result<Vec<u8>>) -> Option<Release> {
	let feed = std::env::var("OBSERVATORY_UPDATE_FEED").unwrap_or_else(|_| FEED.to_string());
	let release = fetch(&feed)
		.ok()
		.and_then(|json| from_feed(&json))
		// The bucket's down, or what it said made no sense: GitHub has the
		// releases too.
		.or_else(|| from_github(&fetch(GITHUB).ok()?))?;
	is_newer(&release.version, current).then_some(release)
}

fn request(url: &str) -> io::Result<ureq::Response> {
	ureq::get(url)
		.set(
			"User-Agent",
			concat!("Observatory/", env!("CARGO_PKG_VERSION")),
		)
		.timeout(Duration::from_secs(30))
		.call()
		.map_err(io::Error::other)
}

/// What's at `url`.
pub fn fetch(url: &str) -> io::Result<Vec<u8>> {
	let mut body = Vec::new();
	request(url)?
		.into_reader()
		.take(LARGEST)
		.read_to_end(&mut body)?;
	Ok(body)
}

#[cfg(target_os = "macos")]
pub use install::{Installed, Staged, installed, relaunch, stage};

// Replacing the app with a new one, on macOS.
#[cfg(target_os = "macos")]
mod install {
	use super::{LARGEST, Release, request};
	use std::io::{self, Read};
	use std::path::{Path, PathBuf};
	use std::process::Command;

	const BUNDLE_ID: &str = "ooo.lilac.observatory";

	/// The copy of the app that's running, where it's one that can replace
	/// itself.
	#[derive(Debug, Clone, PartialEq, Eq)]
	pub struct Installed {
		/// Observatory.app.
		pub app: PathBuf,
		/// Whose certificate it's signed with.
		pub team: String,
	}

	/// A new version, downloaded and checked, waiting to take the place of
	/// the one that's running.
	#[derive(Debug, Clone, PartialEq, Eq)]
	pub struct Staged {
		pub version: String,
		// The new app, and the one it replaces.
		new: PathBuf,
		old: PathBuf,
	}

	fn run(program: &str, args: &[&std::ffi::OsStr]) -> Result<String, String> {
		let output = Command::new(program)
			.args(args)
			.output()
			.map_err(|error| format!("{program}: {error}"))?;
		// codesign says what it finds on stderr.
		let said = format!(
			"{}{}",
			String::from_utf8_lossy(&output.stdout),
			String::from_utf8_lossy(&output.stderr)
		);
		if output.status.success() {
			Ok(said)
		} else {
			Err(format!("{program}: {}", said.trim()))
		}
	}

	// The team whose certificate `app` is signed with. None for one signed ad
	// hoc, or not at all.
	fn team_of(app: &Path) -> Option<String> {
		let signature = run(
			"/usr/bin/codesign",
			&["-dv".as_ref(), "--verbose=2".as_ref(), app.as_ref()],
		)
		.ok()?;
		let team = signature
			.lines()
			.find_map(|line| line.strip_prefix("TeamIdentifier="))?
			.trim();
		(!team.is_empty() && team != "not set").then(|| team.to_string())
	}

	fn plist_string(app: &Path, key: &str) -> Option<String> {
		let plist = app.join("Contents/Info.plist");
		let value = run(
			"/usr/bin/plutil",
			&[
				"-extract".as_ref(),
				key.as_ref(),
				"raw".as_ref(),
				plist.as_ref(),
			],
		)
		.ok()?;
		Some(value.trim().to_string())
	}

	/// The running copy, if it's an app that can be swapped for another: in
	/// a bundle, signed with a certificate, somewhere the user can write, and
	/// not run from where macOS puts a quarantined app it's keeping apart
	/// (there, the real one can't be found to replace).
	pub fn installed() -> Option<Installed> {
		let exe = std::env::current_exe().ok()?;
		let app = exe.ancestors().nth(3)?.to_path_buf();
		if app.extension()? != "app" || exe.to_string_lossy().contains("/AppTranslocation/") {
			return None;
		}
		let writable = run("/bin/test", &["-w".as_ref(), app.parent()?.as_ref()]).is_ok();
		if !writable {
			return None;
		}
		Some(Installed {
			team: team_of(&app)?,
			app,
		})
	}

	// Somewhere to put the download, cleared of whatever the last one left.
	fn staging() -> io::Result<PathBuf> {
		let caches = dirs::cache_dir().ok_or_else(|| io::Error::other("no caches folder"))?;
		let staging = caches.join(BUNDLE_ID).join("update");
		let _ = std::fs::remove_dir_all(&staging);
		std::fs::create_dir_all(&staging)?;
		Ok(staging)
	}

	/// Downloads `release`'s build and checks it's what it should be: an
	/// Observatory of that version, whole, and signed by the same team as
	/// the copy that's running. Whoever can write to the bucket or the
	/// releases can't sign as that team, so this is what keeps them from
	/// handing the app something else to run.
	pub fn stage(release: &Release, installed: &Installed) -> Result<Staged, String> {
		let url = release.download.as_deref().ok_or("no build to download")?;
		let staging = staging().map_err(|error| error.to_string())?;
		let zip = staging.join("update.zip");
		{
			let response = request(url).map_err(|error| error.to_string())?;
			let mut file = std::fs::File::create(&zip).map_err(|error| error.to_string())?;
			io::copy(&mut response.into_reader().take(LARGEST), &mut file)
				.map_err(|error| error.to_string())?;
		}
		let unpacked = staging.join("unpacked");
		run(
			"/usr/bin/ditto",
			&[
				"-x".as_ref(),
				"-k".as_ref(),
				zip.as_ref(),
				unpacked.as_ref(),
			],
		)?;
		let _ = std::fs::remove_file(&zip);

		let new = unpacked.join("Observatory.app");
		run(
			"/usr/bin/codesign",
			&[
				"--verify".as_ref(),
				"--deep".as_ref(),
				"--strict".as_ref(),
				new.as_ref(),
			],
		)?;
		let team = team_of(&new).ok_or("the download isn't signed with a certificate")?;
		if team != installed.team {
			return Err(format!(
				"the download is signed by {team}, not {}",
				installed.team
			));
		}
		if plist_string(&new, "CFBundleIdentifier").as_deref() != Some(BUNDLE_ID) {
			return Err("the download isn't Observatory".to_string());
		}
		if plist_string(&new, "CFBundleShortVersionString").as_deref() != Some(&release.version) {
			return Err(format!("the download isn't version {}", release.version));
		}
		Ok(Staged {
			version: release.version.clone(),
			new,
			old: installed.app.clone(),
		})
	}

	/// Puts the new app where the old one is, and starts it once this one has
	/// gone. The caller quits when this comes back Ok.
	pub fn relaunch(staged: &Staged) -> Result<(), String> {
		swap(&staged.new, &staged.old)?;
		if let Some(staging) = staged.new.parent().and_then(Path::parent) {
			let _ = std::fs::remove_dir_all(staging);
		}
		// Opened a moment from now, by which time this copy has quit.
		Command::new("/bin/sh")
			.args(["-c", "sleep 1; /usr/bin/open \"$0\""])
			.arg(&staged.old)
			.spawn()
			.map_err(|error| error.to_string())?;
		Ok(())
	}

	// Puts a copy of the app at `new` where the one at `old` is. If it can't,
	// the old one is left as it was.
	fn swap(new: &Path, old: &Path) -> Result<(), String> {
		let folder = old.parent().ok_or("the app isn't in a folder")?;
		// Beside the old one first, since the download may be on another
		// disk, and only a rename within one is all-or-nothing.
		let arriving = folder.join(".Observatory.update.app");
		let leaving = folder.join(".Observatory.old.app");
		let _ = std::fs::remove_dir_all(&arriving);
		let _ = std::fs::remove_dir_all(&leaving);
		run("/usr/bin/ditto", &[new.as_ref(), arriving.as_ref()])?;
		std::fs::rename(old, &leaving).map_err(|error| error.to_string())?;
		if let Err(error) = std::fs::rename(&arriving, old) {
			// Put it back as it was.
			let _ = std::fs::rename(&leaving, old);
			let _ = std::fs::remove_dir_all(&arriving);
			return Err(error.to_string());
		}
		let _ = std::fs::remove_dir_all(&leaving);
		Ok(())
	}

	#[cfg(test)]
	mod tests {
		use super::*;

		#[test]
		fn the_new_app_takes_the_old_ones_place() {
			let dir = std::env::temp_dir().join(format!("observatory-swap-{}", std::process::id()));
			let _ = std::fs::remove_dir_all(&dir);
			let (old, new) = (
				dir.join("Applications/Observatory.app"),
				dir.join("staging/Observatory.app"),
			);
			for (app, version) in [(&old, "old"), (&new, "new")] {
				std::fs::create_dir_all(app.join("Contents")).unwrap();
				std::fs::write(app.join("Contents/version"), version).unwrap();
			}
			std::fs::write(old.join("Contents/only-in-old"), "").unwrap();

			swap(&new, &old).unwrap();
			assert_eq!(
				std::fs::read_to_string(old.join("Contents/version")).unwrap(),
				"new"
			);
			// It's the new app, not the new one's files over the old one's.
			assert!(!old.join("Contents/only-in-old").exists());
			// Nothing's left beside it.
			let beside: Vec<_> = std::fs::read_dir(dir.join("Applications"))
				.unwrap()
				.map(|entry| entry.unwrap().file_name())
				.collect();
			assert_eq!(beside, ["Observatory.app"]);

			// One that isn't there to copy leaves the old one alone.
			assert!(swap(&dir.join("nowhere.app"), &old).is_err());
			assert_eq!(
				std::fs::read_to_string(old.join("Contents/version")).unwrap(),
				"new"
			);
			let _ = std::fs::remove_dir_all(&dir);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const FEED_JSON: &str = r#"{
		"version": "1.2.0",
		"url": "https://github.com/aslilac/observatory/releases/tag/v1.2.0",
		"downloads": { "darwin-arm64": "https://releases.example/Observatory-darwin-arm64-1.2.0.zip" }
	}"#;

	const GITHUB_JSON: &str = r#"[
		{ "tag_name": "v1.3.0", "draft": true, "html_url": "https://example/draft", "assets": [] },
		{
			"tag_name": "v1.2.0", "draft": false, "prerelease": true,
			"html_url": "https://github.com/aslilac/observatory/releases/tag/v1.2.0",
			"assets": [
				{ "name": "something-else.zip", "browser_download_url": "https://example/other" },
				{
					"name": "Observatory-darwin-arm64-1.2.0.zip",
					"browser_download_url": "https://example/Observatory-darwin-arm64-1.2.0.zip"
				}
			]
		}
	]"#;

	// The bucket and GitHub, as they'd answer.
	fn network(feed: Option<&'static str>) -> impl Fn(&str) -> io::Result<Vec<u8>> {
		move |url| match (url == GITHUB, feed) {
			(true, _) => Ok(GITHUB_JSON.into()),
			(false, Some(feed)) => Ok(feed.into()),
			(false, None) => Err(io::Error::other("the bucket is down")),
		}
	}

	#[test]
	fn the_bucket_says_what_is_newest() {
		let release = check("1.1.0", network(Some(FEED_JSON))).unwrap();
		assert_eq!(release.version, "1.2.0");
		assert!(release.page.ends_with("/v1.2.0"));
		if platform().is_some() {
			assert!(
				release
					.download
					.unwrap()
					.starts_with("https://releases.example/")
			);
		} else {
			assert_eq!(release.download, None);
		}
	}

	#[test]
	fn github_says_when_the_bucket_cannot() {
		for bucket in [None, Some("not json"), Some("{}")] {
			let release = check("1.2.0-beta.3", network(bucket)).unwrap();
			// The draft above it isn't out.
			assert_eq!(release.version, "1.2.0");
			if platform().is_some() {
				assert!(
					release
						.download
						.unwrap()
						.starts_with("https://example/Observatory-")
				);
			}
		}
	}

	#[test]
	fn nothing_newer_is_nothing_to_say() {
		assert_eq!(check("1.2.0", network(Some(FEED_JSON))), None);
		assert_eq!(check("2.0.0", network(None)), None);
		// Nothing can be reached at all.
		assert_eq!(check("1.0.0", |_| Err(io::Error::other("offline"))), None);
	}
}
