import { describe, expect, it } from "vitest";

import { ringRadii, layerRadii } from "./sunburstGeometry";
import { type Arc, type Wedge, wedgeKey } from "./sunburstLayout";
import {
	planTransition,
	posePartway,
	toNewView,
	toOldView,
	viewMapping,
	wedgePath,
} from "./sunburstTransition";

const root = "/";
const arcs = (entries: [string[], Arc][]) =>
	new Map(entries.map(([names, arc]) => [wedgeKey(root, names), arc]));

describe("viewMapping", () => {
	// The root view of a disk that's half full: Users is the first fifth of
	// the circle, and Users/a is half of that, a ring further out.
	const rootView = { root, cursor: [], span: 0.5 };
	const usersView = { root, cursor: ["Users"], span: 1 };
	const rootArcs = arcs([
		[["Users"], { x0: 0, x1: 0.2, layer: 0 }],
		[["Users", "a"], { x0: 0, x1: 0.1, layer: 1 }],
		[["System"], { x0: 0.2, x1: 0.5, layer: 0 }],
	]);
	const usersArcs = arcs([[["Users", "a"], { x0: 0, x1: 0.5, layer: 0 }]]);

	it("maps a folder's view into the wedge it was opened from", () => {
		const m = viewMapping(rootView, usersView, rootArcs, usersArcs)!;
		expect(toOldView({ x0: 0, x1: 0.5, layer: 0 }, m)).toEqual({
			x0: 0,
			x1: 0.1,
			layer: 1,
		});
		// What was beside it squeezes shut at the edge, and it sinks into the
		// center.
		expect(toNewView({ x0: 0.2, x1: 0.5, layer: 0 }, m)).toEqual({
			x0: 1,
			x1: 1,
			layer: -1,
		});
	});

	it("maps back out the same way", () => {
		const into = viewMapping(rootView, usersView, rootArcs, usersArcs)!;
		const out = viewMapping(usersView, rootView, usersArcs, rootArcs)!;
		const arc = { x0: 0.25, x1: 0.75, layer: 2 };
		const there = toNewView(arc, out);
		const back = toOldView(arc, into);
		expect(there.x0).toBeCloseTo(back.x0);
		expect(there.x1).toBeCloseTo(back.x1);
		expect(there.layer).toBe(back.layer);
	});

	it("is the identity for the same folder", () => {
		expect(viewMapping(usersView, usersView, usersArcs, usersArcs)).toEqual({
			scale: 1,
			offset: 0,
			shift: 0,
		});
	});

	it("gives up on folders that don't contain each other", () => {
		const other = { root, cursor: ["System"], span: 1 };
		expect(viewMapping(usersView, other, usersArcs, new Map())).toBeNull();
		// Or when the folder opened was too small to draw.
		const tiny = { root, cursor: ["Tiny"], span: 1 };
		expect(viewMapping(rootView, tiny, rootArcs, new Map())).toBeNull();
	});
});

describe("planTransition", () => {
	const wedge = (key: string, arc: Arc): Wedge => ({
		key,
		arc,
		depth: 0,
		type: "directory",
		fill: "red",
		file: { type: "file", name: key, size: 1, mtime: 0 },
		path: [key],
	});
	const m = { scale: 0.5, offset: 0.25, shift: 1 };

	it("moves what's in both, fades in what's new, fades out what's gone", () => {
		const shown = new Map([
			["kept", { arc: { x0: 0, x1: 0.5, layer: 1 }, opacity: 1, fill: "red" }],
			["gone", { arc: { x0: 0.5, x1: 1, layer: 0 }, opacity: 1, fill: "blue" }],
		]);
		const { tracks, ghosts } = planTransition(
			shown,
			[
				wedge("kept", { x0: 0, x1: 1, layer: 0 }),
				wedge("new", { x0: 0.5, x1: 1, layer: 1 }),
			],
			m,
		);
		const byKey = new Map(tracks.map((t) => [t.key, t]));
		expect(byKey.get("kept")!.from.arc).toEqual({ x0: 0, x1: 0.5, layer: 1 });
		expect(byKey.get("new")!.from).toEqual({
			arc: { x0: 0.5, x1: 0.75, layer: 2 },
			opacity: 0,
		});
		expect(byKey.get("gone")!.to.opacity).toBe(0);
		expect(byKey.get("gone")!.ghost).toBe(true);
		expect(ghosts.map((g) => [g.key, g.fill])).toEqual([["gone", "blue"]]);
	});

	it("goes partway in a straight line", () => {
		const from = { arc: { x0: 0, x1: 0.5, layer: 0 }, opacity: 0 };
		const to = { arc: { x0: 0.5, x1: 1, layer: 2 }, opacity: 1 };
		expect(posePartway(from, to, 0.5)).toEqual({
			arc: { x0: 0.25, x1: 0.75, layer: 1 },
			opacity: 0.5,
		});
	});
});

describe("ringRadii", () => {
	it("matches the rings at whole layers", () => {
		for (const layer of [0, 1, 4, 5, 6]) {
			expect(ringRadii(layer)).toEqual(layerRadii(layer));
		}
	});

	it("goes between them, and into the center below the first", () => {
		const a = layerRadii(1);
		const b = layerRadii(2);
		expect(ringRadii(1.5)).toEqual({
			ir: (a.ir + b.ir) / 2,
			or: (a.or + b.or) / 2,
		});
		expect(ringRadii(-1)).toEqual({ ir: 0, or: layerRadii(0).ir });
		expect(ringRadii(-3)).toEqual({ ir: 0, or: 0 });
	});
});

describe("wedgePath", () => {
	it("draws nothing for a wedge squeezed shut", () => {
		expect(wedgePath({ x0: 1, x1: 1, layer: 0 })).toBe("");
		expect(wedgePath({ x0: 0, x1: 0.5, layer: -2 })).toBe("");
		expect(wedgePath({ x0: 0, x1: 0.5, layer: 0 })).not.toBe("");
	});
});
