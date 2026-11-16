// Stamps the commit the app was built from into it, for the About window and
// bug reports: `OBSERVATORY_COMMIT` is the commit's hash, with "-dirty" after
// it if the checkout had changes, or empty if there's no telling.
//
// It comes from git, or failing that from a `.commit` file at the top of the
// repo, for a build from a copy of the source that has no `.git` (a
// Flatpak's, or a release's, whose scripts write the file).

use std::path::Path;
use std::process::Command;

fn git(top: &Path, args: &[&str]) -> Option<String> {
	let output = Command::new("git")
		.arg("-C")
		.arg(top)
		.args(args)
		.output()
		.ok()?;
	output
		.status
		.success()
		.then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn main() {
	let top = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
	let stamped = top.join(".commit");
	println!("cargo:rerun-if-changed={}", stamped.display());

	let from_git = git(&top, &["rev-parse", "HEAD"]).map(|commit| {
		// A commit, a checkout of another, and staging or unstaging all
		// change one of these.
		for file in ["HEAD", "index"] {
			if let Some(path) = git(&top, &["rev-parse", "--git-path", file]) {
				println!("cargo:rerun-if-changed={}", top.join(path).display());
			}
		}
		// And an edit, or the undoing of one, changes one of these. Without
		// them the answer is only what it was the last time something above
		// changed: "modified" long after the change was put back, or not when
		// there's one since.
		for file in git(&top, &["ls-files"]).unwrap_or_default().lines() {
			println!("cargo:rerun-if-changed={}", top.join(file).display());
		}
		// Only what git keeps counts, as for `git describe --dirty`: a stray
		// file beside the source isn't a change to it (and nothing above
		// would notice it come or go).
		let changed = git(&top, &["status", "--porcelain", "--untracked-files=no"])
			.is_some_and(|status| !status.is_empty());
		if changed {
			format!("{commit}-dirty")
		} else {
			commit
		}
	});
	let commit = from_git
		.or_else(|| Some(std::fs::read_to_string(&stamped).ok()?.trim().to_string()))
		.unwrap_or_default();
	println!("cargo:rustc-env=OBSERVATORY_COMMIT={commit}");

	windows_resources(&top);
}

// On Windows, the icon and what the program says it is go into the exe
// itself: Explorer shows the icon, gpui gives the window and the taskbar
// the one numbered 1 (which this is), and Task Manager reads the name.
#[cfg(windows)]
fn windows_resources(top: &Path) {
	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
		return;
	}
	let icon = top.join("build-resources/icon.ico");
	println!("cargo:rerun-if-changed={}", icon.display());
	let mut resources = winresource::WindowsResource::new();
	resources
		.set_icon(&icon.to_string_lossy())
		.set("ProductName", "Observatory")
		.set("FileDescription", "Observatory")
		.set("LegalCopyright", "© 2019-2026 McKayla Washburn-Love");
	resources
		.compile()
		.expect("the icon couldn't be built into the program");
}

#[cfg(not(windows))]
fn windows_resources(_: &Path) {}
