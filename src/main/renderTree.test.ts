import { describe, expect, it } from "vitest";

import type { RenderSlice } from "./native.js";
import { assembleRenderTree } from "./renderTree.js";

// The pruning itself is tested with the scanner, in src/scanner/tree.rs.

function file(name: string, size: number): Ob.VfsFile {
	return { type: "file", name, size, mtime: 0 };
}

function dir(name: string, size: number): Ob.VfsDirectory {
	return { type: "directory", name, size, mtime: 0, files: [] };
}

function slice(list: Ob.VfsNode[], extra: Partial<RenderSlice> = {}) {
	const size = list.reduce((s, c) => s + c.size, 0);
	return {
		name: "root",
		rootSize: size,
		position: 0,
		size,
		list,
		sunburst: list,
		...extra,
	};
}

describe("assembleRenderTree", () => {
	it("passes the list and sunburst through as-is", () => {
		const list = [file("c.bin", 300), file("a.bin", 200), file("b.bin", 100)];
		const tree = assembleRenderTree(slice(list), [], null);
		expect(tree.list.files).toBe(list);
		expect(tree.sunburst.files).toBe(list);
	});

	it("sorts tree.files alphabetically, ignoring case", () => {
		const tree = assembleRenderTree(
			slice([dir("zebra", 1000), file("Mango.bin", 900), file("apple.bin", 1)]),
			[],
			null,
		);
		expect(tree.tree.files.map((f) => f.name)).toEqual([
			"apple.bin",
			"Mango.bin",
			"zebra",
		]);
	});

	it("falls back to sizes when there's no drive", () => {
		const tree = assembleRenderTree(slice([file("a.bin", 1000)]), [], null);
		expect(tree.name).toBe("root");
		expect(tree.rootCapacity).toBe(1000);
		expect(tree.rootSize).toBe(1000);
		expect(tree.capacity).toBe(1000);
	});

	it("names and sizes a disk's root after the drive", () => {
		const tree = assembleRenderTree(slice([file("a.bin", 1000)]), [], {
			name: "Macintosh HD",
			capacity: 5000,
		});
		expect(tree.name).toBe("Macintosh HD");
		expect(tree.rootCapacity).toBe(5000);
		expect(tree.rootSize).toBe(1000);
		expect(tree.capacity).toBe(5000);
	});

	it("keeps the drive's name but not its capacity below the root", () => {
		const tree = assembleRenderTree(
			slice([file("doc.bin", 100)], { rootSize: 1000, position: 0.5 }),
			["Users"],
			{ name: "Macintosh HD", capacity: 5000 },
		);
		expect(tree.name).toBe("Macintosh HD");
		expect(tree.cursor).toEqual(["Users"]);
		expect(tree.rootCapacity).toBe(5000);
		expect(tree.capacity).toBe(100);
		expect(tree.size).toBe(100);
		expect(tree.position).toBe(0.5);
	});

	it("ignores a drive that doesn't know its capacity", () => {
		const tree = assembleRenderTree(slice([file("a.bin", 1000)]), [], {
			name: "Untitled",
			capacity: null,
		});
		expect(tree.rootCapacity).toBe(1000);
		expect(tree.capacity).toBe(1000);
	});
});
