import { describe, expect, it } from "vitest";

import { huesByPosition, sunburstColor } from "./colors.js";

function file(name: string, size: number): Ob.VfsFile {
	return { type: "file", name, size, mtime: 0 };
}

describe("huesByPosition", () => {
	it("splits the root's 0..360 range proportionally, largest first", () => {
		// 20% → [0, 72), 10% → [72, 108), 70% → [108, 360); hue is the midpoint.
		const hues = huesByPosition(
			[file("a", 20), file("b", 10), file("c", 70)],
			0,
			100,
		);
		expect(hues.get("a")).toBeCloseTo(36);
		expect(hues.get("b")).toBeCloseTo(90);
		expect(hues.get("c")).toBeCloseTo(234);
	});

	it("splits a child directory's range among its own children", () => {
		// "b" sits at [72, 108) of a 100-byte root (position 0.2). Its 6- and
		// 4-byte children take the first 60% and last 40% of that range:
		// [72, 93.6) and [93.6, 108).
		const hues = huesByPosition([file("b1", 6), file("b2", 4)], 0.2, 100);
		expect(hues.get("b1")).toBeCloseTo(82.8);
		expect(hues.get("b2")).toBeCloseTo(100.8);
	});

	it("returns no hues for an empty root", () => {
		expect(huesByPosition([file("a", 0)], 0, 0).size).toBe(0);
	});
});

describe("sunburstColor", () => {
	it("gives files the color folders approach as they get deeper", () => {
		for (const dark of [false, true]) {
			const file = sunburstColor(120, 1, "file", dark);
			expect(sunburstColor(120, 9, "file", dark)).toBe(file);
			expect(sunburstColor(120, 1, "directory", dark)).not.toBe(file);
			expect(sunburstColor(120, 200, "directory", dark)).toBe(file);
		}
	});
});
