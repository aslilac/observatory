// Observatory, short of anything that draws: the scans and the disks, what a
// view shows of them, and what the app remembers. The desktop app
// (src/desktop) is one thing that draws it; nothing here knows about windows
// or GPUs, so something else (a terminal, say) can be another.

pub mod access;
pub mod cleanup;
pub mod color;
pub mod drives;
pub mod fake_disk;
pub mod finders;
pub mod format;
pub mod issues;
pub mod listing;
pub mod navigation;
pub mod paths;
pub mod reserved;
pub mod scans;
pub mod sky;
pub mod store;
pub mod sunburst;
pub mod system;
pub mod tree;
pub mod version;

// The scanner's own types, for what they're called here.
pub use observatory_scan::admin;
pub use observatory_scan::find::{Finder, Found, Match, Query, Summary};
pub use observatory_scan::reserved::ReservedKind;
pub use observatory_scan::{CountsSnapshot, Reserved, ScanError, ScanErrorKind};
