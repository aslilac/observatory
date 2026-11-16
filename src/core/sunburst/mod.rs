// The sunburst, short of drawing it: where its wedges are (layout.rs), how
// they move from one folder's view to the next (transition.rs), and the
// shapes that come to (geometry.rs). The desktop app fills those shapes on
// the GPU; a terminal could ask of each pixel which wedge covers it.

pub mod geometry;
pub mod layout;
pub mod transition;

pub use geometry::{CENTER_RADIUS, VIEW_RADIUS, outline};
pub use layout::{LayoutInput, Wedge, layout_wedges, wedge_key};
pub use transition::{Drawn, Hit, Sunburst, View};

/// Where a wedge is: from `x0` to `x1` turns around the circle, in ring
/// `layer` (fractional while it's moving between rings).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sweep {
	pub x0: f64,
	pub x1: f64,
	pub layer: f64,
}
