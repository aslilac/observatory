import { describe, expect, it } from "vitest";

import { arcPath, isDrawable } from "./sunburstGeometry";

// SVG silently drops an `A` command whose endpoint equals the current point,
// so count those. Handles the subset of path syntax arcPath emits: M, L, A, Z.
function degenerateArcs(d: string): number {
	const tokens = d.split(" ");
	let count = 0;
	let current = "";
	let subpathStart = "";
	for (let i = 0; i < tokens.length;) {
		const command = tokens[i++];
		if (command === "M") {
			current = subpathStart = `${tokens[i]} ${tokens[i + 1]}`;
			i += 2;
		} else if (command === "L") {
			current = `${tokens[i]} ${tokens[i + 1]}`;
			i += 2;
		} else if (command === "A") {
			const end = `${tokens[i + 5]} ${tokens[i + 6]}`;
			if (end === current) {
				count++;
			}
			current = end;
			i += 7;
		} else if (command === "Z") {
			current = subpathStart;
		}
	}
	return count;
}

describe("arcPath", () => {
	it("draws a wedge with an outer and inner arc", () => {
		const d = arcPath(0.1, 0.25, 70, 101);
		expect(d.match(/A /g)).toHaveLength(2);
		expect(degenerateArcs(d)).toBe(0);
	});

	it("draws a full turn as a complete ring rather than nothing", () => {
		// A directory whose only child is 100% of it.
		const d = arcPath(0, 1, 70, 101);
		expect(d.match(/A /g)).toHaveLength(4);
		expect(degenerateArcs(d)).toBe(0);
	});

	it("never emits an arc SVG would drop, near or at a full turn", () => {
		// Innermost through outermost ring radii.
		for (const [ir, or] of [
			[70, 101],
			[194, 225],
			[268, 273],
		] as const) {
			for (const size of [0.5, 0.9, 0.999, 0.9999, 0.99999, 1]) {
				expect(degenerateArcs(arcPath(0.3, size, ir, or))).toBe(0);
			}
		}
	});
});

describe("isDrawable", () => {
	it("needs a wider share of a turn in the inner rings than the outer ones", () => {
		// 0.4% of a turn is about 2 units across the innermost ring but more
		// than 5 across the outermost.
		expect(isDrawable(0.004, 0)).toBe(false);
		expect(isDrawable(0.004, 6)).toBe(true);
	});

	it("draws anything a few units wide", () => {
		for (let layer = 0; layer <= 6; layer++) {
			expect(isDrawable(0.01, layer)).toBe(true);
			expect(isDrawable(0.001, layer)).toBe(false);
		}
	});
});
