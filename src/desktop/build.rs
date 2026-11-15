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
		let changed =
			git(&top, &["status", "--porcelain"]).is_some_and(|status| !status.is_empty());
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
}
