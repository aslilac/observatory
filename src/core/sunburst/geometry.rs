// Where the sunburst's rings are, in the units it's laid out in: a square
// `VIEW_RADIUS` to each side of the center, which whatever draws it scales
// to the room it has.

use super::Sweep;
use std::f64::consts::{PI, TAU};

/// Half the side of the square the sunburst is laid out in.
pub const VIEW_RADIUS: f64 = 275.0;
/// The circle in the middle, which says how big the current folder is, and
/// goes up a folder when clicked.
pub const CENTER_RADIUS: f64 = 64.0;

// Where position 0 is: 5/8 of the way around, the top left.
const BASE_ANGLE_TURNS: f64 = 5.0 / 8.0;

// The gap between neighboring wedges. Each gives up half of it, on every
// side.
const GAP: f64 = 0.9;

/// The inner and outer radius of a ring.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Radii {
	pub inner: f64,
	pub outer: f64,
}

const NOTHING: Radii = Radii {
	inner: 0.0,
	outer: 0.0,
};

// Five 31-unit inner rings followed by tighter 5-unit outer rings for deep
// hierarchies.
pub fn layer_radii(layer: usize) -> Radii {
	if layer > 4 {
		let inner = 228.0 + 8.0 * (layer - 5) as f64;
		return Radii {
			inner,
			outer: inner + 5.0,
		};
	}
	let inner = 70.0 + 31.0 * layer as f64;
	Radii {
		inner,
		outer: inner + 31.0,
	}
}

// The radii of a ring that may be partway between two layers, as a wedge is
// while the sunburst moves from one folder to another. Layer -1 is the
// center circle, where the current folder sits, and anything further in
// shrinks to nothing, so a parent folder sinks into the center as the user
// opens one of its children.
pub fn ring_radii(layer: f64) -> Radii {
	if layer <= -2.0 {
		return NOTHING;
	}
	let lower = layer.floor();
	let t = layer - lower;
	let a = whole_ring_radii(lower);
	if t == 0.0 {
		return a;
	}
	let b = whole_ring_radii(lower + 1.0);
	Radii {
		inner: a.inner + (b.inner - a.inner) * t,
		outer: a.outer + (b.outer - a.outer) * t,
	}
}

fn whole_ring_radii(layer: f64) -> Radii {
	if layer <= -2.0 {
		NOTHING
	} else if layer == -1.0 {
		Radii {
			inner: 0.0,
			outer: layer_radii(0).inner,
		}
	} else {
		layer_radii(layer as usize)
	}
}

// The narrowest wedge worth drawing, as arc length halfway through its ring.
// The gap eats about one unit of every wedge, so anything thinner comes out
// as a smeared, antialiased hairline. Measured per ring because the same
// share of a turn is less than half as wide in the innermost ring as in the
// outermost.
const MIN_ARC: f64 = 3.0;

/// Whether a wedge `size` turns wide is wide enough to draw in `layer`.
pub fn is_drawable(size: f64, layer: usize) -> bool {
	let Radii { inner, outer } = layer_radii(layer);
	size * PI * (inner + outer) >= MIN_ARC
}

// Anything this close to a whole turn is drawn as a complete ring: its two
// straight edges would meet, and the gap between them would be a seam
// through a folder that has the circle to itself. Any sibling that small
// would have been pruned from the sunburst anyway.
const FULL_TURN: f64 = 0.9999;

/// A point, in the sunburst's units from its center, x to the right and y
/// down.
pub type Point = (f32, f32);

fn point(radius: f64, angle: f64) -> Point {
	((radius * angle.cos()) as f32, (radius * angle.sin()) as f32)
}

// The points of an arc of `radius` from angle `a` to `b` (radians, either
// way round), near enough to round that the chords are within `tolerance` of
// it.
fn arc_points(out: &mut Vec<Point>, radius: f64, a: f64, b: f64, tolerance: f64) {
	let step = if radius > tolerance {
		2.0 * (1.0 - tolerance / radius).acos()
	} else {
		PI / 2.0
	};
	let chords = ((b - a).abs() / step).ceil().max(1.0) as usize;
	for i in 0..=chords {
		out.push(point(radius, a + (b - a) * i as f64 / chords as f64));
	}
}

/// The outline of a wedge, anywhere, including between rings: the closed
/// shapes to fill, of which there are none if it's squeezed shut, and two for
/// a wedge that goes the whole way round (the outside of the ring, then the
/// hole in it, to fill by the even-odd rule). `tolerance` is how far the
/// straight lines may stray from the curves, in the sunburst's units.
///
/// The outline goes round the outer arc clockwise, in along the wedge's end,
/// back round the inner arc, and out along its start:
///
/// ```text
///       ● ─→ outer arc ─→ ●
///       ↑                 ↓
///       ● ←─ inner arc ←─ ●
/// ```
///
/// All of it is inset by half the gap between wedges, so neighbors come out
/// with the background showing between them.
pub fn outline(sweep: Sweep, tolerance: f64) -> Vec<Vec<Point>> {
	let Radii { inner, outer } = ring_radii(sweep.layer);
	let size = sweep.x1 - sweep.x0;
	let inset = GAP / 2.0;
	// The center circle's wedges have no inner edge to pull in.
	let inner = if inner > 0.0 { inner + inset } else { 0.0 };
	let outer = outer - inset;
	if size < 1e-5 || outer - inner < 0.01 {
		return Vec::new();
	}

	let a = (BASE_ANGLE_TURNS + sweep.x0) * TAU;
	if size >= FULL_TURN {
		let mut ring = vec![Vec::new()];
		arc_points(&mut ring[0], outer, a, a + TAU, tolerance);
		if inner > 0.0 {
			let mut hole = Vec::new();
			arc_points(&mut hole, inner, a, a + TAU, tolerance);
			ring.push(hole);
		}
		return ring;
	}
	let b = (BASE_ANGLE_TURNS + sweep.x1) * TAU;

	// The straight edges are pulled in by the same distance all the way
	// along, which is a wider angle the nearer the center.
	let pulled = |radius: f64| {
		let by = if radius > inset {
			(inset / radius).asin()
		} else {
			PI / 2.0
		};
		// A wedge narrower than the gap here comes to a point.
		let by = by.min((b - a) / 2.0);
		(a + by, b - by)
	};
	let mut shape = Vec::new();
	let (start, end) = pulled(outer);
	arc_points(&mut shape, outer, start, end, tolerance);
	if inner > 0.0 {
		let (start, end) = pulled(inner);
		arc_points(&mut shape, inner, end, start, tolerance);
	} else {
		shape.push((0.0, 0.0));
	}
	vec![shape]
}

/// Where a point is in the sunburst's own terms: how many turns round from
/// where the circle begins (0 to 1), and how far from the center.
pub fn polar(x: f64, y: f64) -> (f64, f64) {
	let turns = (y.atan2(x) / TAU - BASE_ANGLE_TURNS).rem_euclid(1.0);
	(turns, x.hypot(y))
}

/// Whether a wedge at `sweep` covers the point `turns` round and `radius`
/// out (see `polar`).
pub fn covers(sweep: Sweep, turns: f64, radius: f64) -> bool {
	let Radii { inner, outer } = ring_radii(sweep.layer);
	radius >= inner && radius < outer && turns >= sweep.x0 && turns < sweep.x1
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rings() {
		assert_eq!(
			layer_radii(0),
			Radii {
				inner: 70.0,
				outer: 101.0
			}
		);
		assert_eq!(
			layer_radii(4),
			Radii {
				inner: 194.0,
				outer: 225.0
			}
		);
		assert_eq!(
			layer_radii(5),
			Radii {
				inner: 228.0,
				outer: 233.0
			}
		);
		assert_eq!(
			layer_radii(6),
			Radii {
				inner: 236.0,
				outer: 241.0
			}
		);
	}

	#[test]
	fn rings_between_layers() {
		assert_eq!(ring_radii(1.0), layer_radii(1));
		assert_eq!(
			ring_radii(-1.0),
			Radii {
				inner: 0.0,
				outer: 70.0
			}
		);
		assert_eq!(ring_radii(-2.0), NOTHING);
		assert_eq!(ring_radii(-3.5), NOTHING);
		assert_eq!(
			ring_radii(0.5),
			Radii {
				inner: 85.5,
				outer: 116.5
			}
		);
		// Halfway into the center.
		assert_eq!(
			ring_radii(-0.5),
			Radii {
				inner: 35.0,
				outer: 85.5
			}
		);
		// Halfway to nothing.
		assert_eq!(
			ring_radii(-1.5),
			Radii {
				inner: 0.0,
				outer: 35.0
			}
		);
	}

	#[test]
	fn thin_wedges_are_not_drawn() {
		// Three units of arc mid-ring, which is further round the further out.
		let narrowest = |layer| {
			let Radii { inner, outer } = layer_radii(layer);
			MIN_ARC / (PI * (inner + outer))
		};
		assert!(is_drawable(narrowest(0) * 1.01, 0));
		assert!(!is_drawable(narrowest(0) * 0.99, 0));
		assert!(is_drawable(narrowest(0) * 0.99, 4));
	}

	#[test]
	fn outlines() {
		let quarter = Sweep {
			x0: 0.0,
			x1: 0.25,
			layer: 0.0,
		};
		let shapes = outline(quarter, 0.1);
		assert_eq!(shapes.len(), 1);
		// Every point is within the ring, give or take the gap.
		for &(x, y) in &shapes[0] {
			let r = f64::from(x).hypot(f64::from(y));
			assert!((70.0..=101.0).contains(&r), "{r}");
		}

		let shut = Sweep {
			x0: 0.5,
			x1: 0.5,
			layer: 0.0,
		};
		assert!(outline(shut, 0.1).is_empty());
		let gone = Sweep {
			x0: 0.0,
			x1: 0.5,
			layer: -2.0,
		};
		assert!(outline(gone, 0.1).is_empty());

		let whole = Sweep {
			x0: 0.0,
			x1: 1.0,
			layer: 1.0,
		};
		assert_eq!(outline(whole, 0.1).len(), 2);
		// In the center there's no hole.
		let center = Sweep {
			x0: 0.0,
			x1: 1.0,
			layer: -1.0,
		};
		assert_eq!(outline(center, 0.1).len(), 1);
	}

	#[test]
	fn points_land_in_the_wedge_that_covers_them() {
		// The circle begins at the top left, and goes clockwise.
		let (turns, radius) = polar(-60.0, -60.0);
		assert!(turns.abs() < 1e-9 || (turns - 1.0).abs() < 1e-9);
		assert!((radius - 84.85).abs() < 0.01);

		let (turns, radius) = polar(0.0, -80.0);
		assert!((turns - 0.125).abs() < 1e-9);
		let first = Sweep {
			x0: 0.0,
			x1: 0.25,
			layer: 0.0,
		};
		let second = Sweep {
			x0: 0.25,
			x1: 0.5,
			layer: 0.0,
		};
		let above = Sweep {
			x0: 0.0,
			x1: 0.25,
			layer: 1.0,
		};
		assert!(covers(first, turns, radius));
		assert!(!covers(second, turns, radius));
		assert!(!covers(above, turns, radius));
	}
}
