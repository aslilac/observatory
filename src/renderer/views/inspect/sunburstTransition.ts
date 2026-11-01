import { useLayoutEffect, useRef, useState } from "react";
import { arcPath, ringRadii } from "./sunburstGeometry";
import { type Arc, type Wedge, wedgeKey } from "./sunburstLayout";

// Moving from one folder to another, the sunburst zooms the way d3's
// zoomable sunburst does (observablehq.com/@d3/zoomable-sunburst): every
// wedge that's in both views slides from where it was to where it's going,
// the folder that was opened spreads around the circle while its siblings
// squeeze shut at the edge, and its parents sink into the center. Wedges
// only one view has fade, in from or out to where they'd be in the other.

const DURATION = 750;

// Which folder a view is centered on, and how far around the circle its
// contents go (less than a whole turn at the root of a disk, where the rest
// is free space).
export type View = { root: string; cursor: string[]; span: number };

// How a point in the new view maps to the old one: angles scale and shift,
// layers only shift.
export type ViewMapping = { scale: number; offset: number; shift: number };

const IDENTITY: ViewMapping = { scale: 1, offset: 0, shift: 0 };

function startsWith(a: string[], b: string[]): boolean {
	return b.length <= a.length && b.every((name, i) => a[i] === name);
}

// How the `next` view maps onto `prev`, through the folder one of them is
// centered on, which is a wedge in the other. Null if they don't share one
// (a jump elsewhere in the scan, or that wedge was too small to draw), when
// the views just fade into each other.
export function viewMapping(
	prev: View,
	next: View,
	prevArcs: ReadonlyMap<string, Arc>,
	nextArcs: ReadonlyMap<string, Arc>,
): ViewMapping | null {
	if (prev.root !== next.root) {
		return null;
	}
	const { root } = next;
	if (prev.cursor.length === next.cursor.length) {
		return startsWith(prev.cursor, next.cursor) ? IDENTITY : null;
	}
	if (startsWith(next.cursor, prev.cursor)) {
		// In: the new center was a wedge in the old view.
		const opened = prevArcs.get(wedgeKey(root, next.cursor));
		if (!opened || !(next.span > 0)) {
			return null;
		}
		return {
			scale: (opened.x1 - opened.x0) / next.span,
			offset: opened.x0,
			shift: opened.layer + 1,
		};
	}
	if (startsWith(prev.cursor, next.cursor)) {
		// Out: the old center is a wedge in the new view.
		const closed = nextArcs.get(wedgeKey(root, prev.cursor));
		if (!closed || !(prev.span > 0) || !(closed.x1 > closed.x0)) {
			return null;
		}
		const scale = prev.span / (closed.x1 - closed.x0);
		return { scale, offset: -closed.x0 * scale, shift: -(closed.layer + 1) };
	}
	return null;
}

// Angles are kept to the circle, so whatever falls outside it squeezes shut
// at the top-left edge, where the circle begins and ends.
function clampTurn(x: number): number {
	return Math.min(1, Math.max(0, x));
}

export function toOldView(arc: Arc, m: ViewMapping): Arc {
	return {
		x0: clampTurn(arc.x0 * m.scale + m.offset),
		x1: clampTurn(arc.x1 * m.scale + m.offset),
		layer: arc.layer + m.shift,
	};
}

export function toNewView(arc: Arc, m: ViewMapping): Arc {
	return {
		x0: clampTurn((arc.x0 - m.offset) / m.scale),
		x1: clampTurn((arc.x1 - m.offset) / m.scale),
		layer: arc.layer - m.shift,
	};
}

// What's showing of a wedge.
export type Pose = { arc: Arc; opacity: number };

export type Track = {
	key: string;
	ghost: boolean;
	fill: string;
	from: Pose;
	to: Pose;
};

// A wedge that's no longer in the view, drawn while it fades away.
export type Ghost = { key: string; fill: string; from: Pose };

// Where each wedge goes from and to, from what's showing (`shown`, which
// may be partway through another move) to `wedges`.
export function planTransition(
	shown: ReadonlyMap<string, Pose & { fill: string }>,
	wedges: Wedge[],
	mapping: ViewMapping,
): { tracks: Track[]; ghosts: Ghost[] } {
	const tracks: Track[] = [];
	const ghosts: Ghost[] = [];
	const keys = new Set<string>();
	for (const wedge of wedges) {
		keys.add(wedge.key);
		const from = shown.get(wedge.key) ?? {
			arc: toOldView(wedge.arc, mapping),
			opacity: 0,
		};
		tracks.push({
			key: wedge.key,
			ghost: false,
			fill: wedge.fill,
			from: { arc: from.arc, opacity: from.opacity },
			to: { arc: wedge.arc, opacity: 1 },
		});
	}
	for (const [key, pose] of shown) {
		if (keys.has(key)) {
			continue;
		}
		const from = { arc: pose.arc, opacity: pose.opacity };
		ghosts.push({ key, fill: pose.fill, from });
		tracks.push({
			key,
			ghost: true,
			fill: pose.fill,
			from,
			to: { arc: toNewView(pose.arc, mapping), opacity: 0 },
		});
	}
	return { tracks, ghosts };
}

function easeCubicInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function posePartway(from: Pose, to: Pose, t: number): Pose {
	return {
		arc: {
			x0: lerp(from.arc.x0, to.arc.x0, t),
			x1: lerp(from.arc.x1, to.arc.x1, t),
			layer: lerp(from.arc.layer, to.arc.layer, t),
		},
		opacity: lerp(from.opacity, to.opacity, t),
	};
}

function samePose(a: Pose, b: Pose): boolean {
	return (
		a.opacity === b.opacity &&
		a.arc.x0 === b.arc.x0 &&
		a.arc.x1 === b.arc.x1 &&
		a.arc.layer === b.arc.layer
	);
}

// The `d` of a wedge anywhere, including between rings or squeezed shut.
export function wedgePath(arc: Arc): string {
	const { ir, or } = ringRadii(arc.layer);
	const size = arc.x1 - arc.x0;
	// A shut wedge would still draw its stroke as a line.
	if (size < 1e-5 || or - ir < 0.01) {
		return "";
	}
	return arcPath(arc.x0, size, ir, or);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Moves the sunburst's wedges from one view to the next. The wedges' paths
// render where they're going (`wedgePath(wedge.arc)`); while they move, the
// frames are set on the elements directly rather than through React, which
// would rebuild every wedge sixty times a second. Each wedge's path takes
// `bind(key)` as its ref, and each ghost's `bindGhost(key)`.
export function useSunburstTransition(view: View, wedges: Wedge[]) {
	const [ghosts, setGhosts] = useState<Ghost[]>([]);
	const elements = useRef(new Map<string, SVGPathElement>());
	const ghostElements = useRef(new Map<string, SVGPathElement>());
	const shown = useRef(new Map<string, Pose & { fill: string }>());
	const shownView = useRef<View | null>(null);
	const frame = useRef(0);

	// Only a new set of wedges (another folder, a rescan, the theme) moves
	// anything: the view describes the same wedges.
	const viewRef = useRef(view);
	viewRef.current = view;

	useLayoutEffect(() => {
		const view = viewRef.current;
		cancelAnimationFrame(frame.current);

		const prev = shownView.current;
		shownView.current = view;
		const mapping =
			prev &&
			viewMapping(
				prev,
				view,
				new Map(Array.from(shown.current, ([key, pose]) => [key, pose.arc])),
				new Map(wedges.map((wedge) => [wedge.key, wedge.arc])),
			);
		const plan = mapping
			? planTransition(shown.current, wedges, mapping)
			: null;

		const settle = () => {
			shown.current = new Map(
				wedges.map((wedge) => [
					wedge.key,
					{ arc: wedge.arc, opacity: 1, fill: wedge.fill },
				]),
			);
			for (const wedge of wedges) {
				const el = elements.current.get(wedge.key);
				el?.setAttribute("d", wedgePath(wedge.arc));
				el?.removeAttribute("opacity");
			}
			setGhosts([]);
		};

		if (
			!plan ||
			prefersReducedMotion() ||
			plan.tracks.every((track) => samePose(track.from, track.to))
		) {
			settle();
			return;
		}

		const apply = (t: number) => {
			for (const track of plan.tracks) {
				const pose = posePartway(track.from, track.to, t);
				shown.current.set(track.key, { ...pose, fill: track.fill });
				const el = (track.ghost ? ghostElements : elements).current.get(
					track.key,
				);
				if (el) {
					el.setAttribute("d", wedgePath(pose.arc));
					el.setAttribute("opacity", pose.opacity.toFixed(3));
				}
			}
		};

		shown.current = new Map();
		apply(0);
		setGhosts(plan.ghosts);
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / DURATION);
			if (t < 1) {
				apply(easeCubicInOut(t));
				frame.current = requestAnimationFrame(step);
			} else {
				settle();
			}
		};
		frame.current = requestAnimationFrame(step);
	}, [wedges]);

	useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

	const bind =
		(key: string) =>
		(el: SVGPathElement | null): void => {
			if (el) {
				elements.current.set(key, el);
			} else {
				elements.current.delete(key);
			}
		};
	const bindGhost =
		(key: string) =>
		(el: SVGPathElement | null): void => {
			if (el) {
				ghostElements.current.set(key, el);
			} else {
				ghostElements.current.delete(key);
			}
		};

	return { ghosts, bind, bindGhost };
}
