// macOS's Full Disk Access: what a scan can't get into without it, and where
// the user turns it on. The app can't grant it to itself.

/// The Full Disk Access pane of System Settings.
pub const FULL_DISK_ACCESS_SETTINGS: &str =
	"x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/// Whether this process has Full Disk Access, going by the same tell the
/// scanner uses: the user's own privacy database is off limits without it.
/// True off macOS, which has nothing to ask for.
pub fn has_full_disk_access() -> bool {
	if !cfg!(target_os = "macos") {
		return true;
	}
	dirs::home_dir().is_some_and(|home| {
		std::fs::read_dir(home.join("Library/Application Support/com.apple.TCC")).is_ok()
	})
}
