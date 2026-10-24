const BASE_ANGLE_TURNS = 5 / 8;

// Layer ring geometry mirrors the original canvas widths: five 31-unit
// inner rings followed by tighter 5-unit outer rings for deep hierarchies.
export function layerRadii(layer: number): { ir: number; or: number } {
	if (layer > 4) {
		const ir = 228 + 8 * (layer - 5);
		return { ir, or: ir + 5 };
	}
	const ir = 70 + 31 * layer;
	return { ir, or: ir + 31 };
}

// The narrowest wedge worth drawing, as arc length in viewBox units halfway
// through its ring. The gap stroke eats about one unit of every wedge, so
// anything thinner comes out as a smeared, antialiased hairline. Measured
// per ring because the same share of a turn is less than half as wide in
// the innermost ring as in the outermost.
const MIN_ARC = 3;

// Whether a wedge `size` turns wide is wide enough to draw in `layer`.
export function isDrawable(size: number, layer: number): boolean {
	const { ir, or } = layerRadii(layer);
	return size * Math.PI * (ir + or) >= MIN_ARC;
}

// Build the SVG `d` attribute for one wedge of an annulus (donut slice).
//
// Inputs are in "turns" of a unit circle so the rest of the file can stay in
// fractional-of-total terms:
//
//   position  cumulative offset of this wedge's start, 0..1
//   size      angular width of this wedge, 0..1
//   ir, or    inner / outer radius in viewBox units
//
// `a` and `b` are the start and end angles in radians, rotated by
// BASE_ANGLE_TURNS so the 0-position lands where the design wants it (5/8
// of the way around, i.e. roughly the top-left). The `largeArc` flag is
// SVG's way of disambiguating arcs over 180°: 0 picks the short way, 1
// picks the long way. We need it set for any single wedge that wraps more
// than half the circle.
//
// The outline is built outer-arc clockwise, then radially in to the inner
// circle, then inner-arc counter-clockwise (sweep-flag 0) back to the
// starting angle, then closed:
//
//       (ox1,oy1) ─→ outer arc ─→ (ox2,oy2)
//          ↑                          ↓
//       (ix1,iy1) ←─ inner arc ←─ (ix2,iy2)
export function arcPath(
	position: number,
	size: number,
	ir: number,
	or: number,
): string {
	const a = (BASE_ANGLE_TURNS + position) * Math.PI * 2;
	if (size >= FULL_TURN) {
		return ringPath(a, ir, or);
	}
	const b = (BASE_ANGLE_TURNS + position + size) * Math.PI * 2;
	const largeArc = b - a > Math.PI ? 1 : 0;
	const outer = arcEndpoints(or, a, b);
	const inner = arcEndpoints(ir, a, b);

	return [
		`M ${outer.x1} ${outer.y1}`,
		`A ${or} ${or} 0 ${largeArc} 1 ${outer.x2} ${outer.y2}`,
		`L ${inner.x2} ${inner.y2}`,
		`A ${ir} ${ir} 0 ${largeArc} 0 ${inner.x1} ${inner.y1}`,
		"Z",
	].join(" ");
}

// A wedge that spans the whole circle (a directory whose only visible child
// is 100% of it) starts and ends on the same point, and SVG drops any arc
// whose endpoints coincide, so arcPath would draw nothing. Anything this
// close to a full turn is drawn as a complete annulus instead: two
// half-circle arcs per edge, with the inner circle wound the opposite way so
// the nonzero fill rule leaves the hole open. The threshold sits well clear
// of where toFixed(2) rounding would merge the endpoints at our radii, and
// any sibling that small would have been pruned from the sunburst anyway.
const FULL_TURN = 0.9999;

function ringPath(a: number, ir: number, or: number): string {
	const outer = arcEndpoints(or, a, a + Math.PI);
	const inner = arcEndpoints(ir, a, a + Math.PI);
	return [
		`M ${outer.x1} ${outer.y1}`,
		`A ${or} ${or} 0 1 1 ${outer.x2} ${outer.y2}`,
		`A ${or} ${or} 0 1 1 ${outer.x1} ${outer.y1}`,
		"Z",
		`M ${inner.x1} ${inner.y1}`,
		`A ${ir} ${ir} 0 1 0 ${inner.x2} ${inner.y2}`,
		`A ${ir} ${ir} 0 1 0 ${inner.x1} ${inner.y1}`,
		"Z",
	].join(" ");
}

function arcEndpoints(r: number, a: number, b: number) {
	return {
		x1: (r * Math.cos(a)).toFixed(2),
		y1: (r * Math.sin(a)).toFixed(2),
		x2: (r * Math.cos(b)).toFixed(2),
		y2: (r * Math.sin(b)).toFixed(2),
	};
}
