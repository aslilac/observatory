import { describe, expect, it } from "vitest";

import { buildRenderTree } from "./renderTree.js";

function file(name: string, size: number): Ob.VfsFile {
	return { type: "file", name, size, mtime: 0 };
}

function dir(
	name: string,
	children: Ob.VfsNode[],
	opts: { capacity?: number } = {},
): Ob.VfsDirectory {
	const size = children.reduce((s, c) => s + c.size, 0);
	const out: Ob.VfsDirectory = {
		type: "directory",
		name,
		size,
		mtime: 0,
		files: children,
	};
	if (opts.capacity !== undefined) {
		out.capacity = opts.capacity;
	}
	return out;
}

describe("buildRenderTree", () => {
	it("returns null for a cursor that doesn't match any child", () => {
		const root = dir("root", [file("a.bin", 100)]);
		expect(buildRenderTree(root, ["nope"])).toBeNull();
	});

	it("drops files smaller than 0.3% of parent from sunburst, keeps them in list and tree", () => {
		// 10M parent → 0.3% threshold = 30_000 bytes. The 100-byte file falls
		// below it; the 10M file does not.
		const root = dir("root", [
			file("big.bin", 10_000_000),
			file("tiny.bin", 100),
		]);
		const tree = buildRenderTree(root, []);

		expect(tree).not.toBeNull();
		expect(tree!.list.files.map((f) => f.name).sort()).toEqual([
			"big.bin",
			"tiny.bin",
		]);
		expect(tree!.sunburst.files.map((f) => f.name)).toEqual(["big.bin"]);
		expect(tree!.tree.files.map((f) => f.name).sort()).toEqual([
			"big.bin",
			"tiny.bin",
		]);
	});

	it("recurses up to 6 levels into sunburst children", () => {
		// Build root > d0 > d1 > … > d6 > d7 (eight directories deep beyond root),
		// each containing a single large file at the bottom so isLargeEnough
		// never prunes anything.
		let inner: Ob.VfsDirectory = dir("d7", [file("leaf.bin", 1_000_000)]);
		for (let i = 6; i >= 0; i--) {
			inner = dir(`d${i}`, [inner]);
		}
		const root = dir("root", [inner]);
		const tree = buildRenderTree(root, []);

		expect(tree).not.toBeNull();

		// sanitize(6) produces a directory whose `files` is recursed with
		// sanitize(5), … sanitize(0). At sanitize(0) the dir is emitted with
		// files: [] regardless of what it really contains. So starting at the
		// outer sunburst child (d0) we can walk 6 directories before hitting
		// an empty-files leaf.
		let node = tree!.sunburst.files[0] as Ob.VfsDirectory;
		expect(node.name).toBe("d0");

		let depth = 0;
		while (node.files.length > 0 && node.files[0]!.type === "directory") {
			node = node.files[0] as Ob.VfsDirectory;
			depth++;
		}
		expect(depth).toBe(6);
		expect(node.name).toBe("d6");
		// d6 was emitted by sanitize(0): its children are truncated even though
		// the underlying VFS has d7 inside.
		expect(node.files).toEqual([]);
	});

	it("returns tree.files as immediate children only, sorted alphabetically", () => {
		const root = dir("root", [
			dir("zebra", [file("nested.bin", 1)]),
			file("apple.bin", 1000),
			file("mango.bin", 1000),
		]);
		const tree = buildRenderTree(root, []);

		expect(tree!.tree.files.map((f) => f.name)).toEqual([
			"apple.bin",
			"mango.bin",
			"zebra",
		]);
		// And the zebra directory's children are NOT recursively populated —
		// FolderTree fetches deeper levels on demand.
		const zebra = tree!.tree.files.find((f) => f.name === "zebra") as
			| Ob.VfsDirectory
			| undefined;
		expect(zebra?.type).toBe("directory");
		expect(zebra?.files).toEqual([]);
	});

	it("returns list.files in the order they appear in the VFS", () => {
		// The scanner sorts by size descending at scan time. buildRenderTree
		// shouldn't re-sort `list.files` — it should pass them through.
		const root = dir("root", [
			file("c.bin", 300),
			file("a.bin", 200),
			file("b.bin", 100),
		]);
		const tree = buildRenderTree(root, []);
		expect(tree!.list.files.map((f) => f.name)).toEqual([
			"c.bin",
			"a.bin",
			"b.bin",
		]);
	});

	it("descends into a child via cursor", () => {
		const child = dir("child", [file("inside.bin", 5000)]);
		const root = dir("root", [child, file("sibling.bin", 5000)]);
		const tree = buildRenderTree(root, ["child"]);

		expect(tree).not.toBeNull();
		expect(tree!.cursor).toEqual(["child"]);
		expect(tree!.size).toBe(5000);
		expect(tree!.list.files.map((f) => f.name)).toEqual(["inside.bin"]);
	});

	it("computes position as the fraction of root.size taken by preceding siblings", () => {
		// Root.size = 1000. `c` is preceded by a.bin (250) and b.bin (250),
		// so its position = 0.5.
		const root = dir("root", [
			file("a.bin", 250),
			file("b.bin", 250),
			dir("c", [file("inside.bin", 500)]),
		]);
		const tree = buildRenderTree(root, ["c"]);
		expect(tree!.position).toBeCloseTo(0.5, 5);
	});

	it("falls back to size when capacity is unset", () => {
		const root = dir("root", [file("a.bin", 1000)]);
		const tree = buildRenderTree(root, []);
		expect(tree!.rootCapacity).toBe(1000);
		expect(tree!.rootSize).toBe(1000);
		expect(tree!.capacity).toBe(1000);
	});

	it("uses root.capacity (drive capacity) when present", () => {
		const root = dir("root", [file("a.bin", 1000)], { capacity: 5000 });
		const tree = buildRenderTree(root, []);
		expect(tree!.rootCapacity).toBe(5000);
		expect(tree!.rootSize).toBe(1000);
	});

	it("preserves the root name across cursor descents", () => {
		const root = dir("Macintosh HD", [
			dir("Users", [file("doc.bin", 100)]),
		]);
		const tree = buildRenderTree(root, ["Users"]);
		expect(tree!.name).toBe("Macintosh HD");
	});
});
