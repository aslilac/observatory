import type { RenderSlice } from "./native";

// For a scan of a whole disk: what the scanner, which knows nothing about
// drives, can't say about its root.
export type ScanDrive = {
	name: string;
	capacity: number | null;
};

// Turns the scanner's slice of a directory into the RenderTree the renderer
// draws. The pruning already happened in Rust, next to the tree (see
// src/scanner/tree.rs); what's left is the drive glue, and the folder tree
// view's alphabetical order, which wants the locale-aware collation JS has.
//
// Three views of the same directory:
//   list      — all immediate children, as-is order (size desc from scan)
//   sunburst  — drop anything < 0.3% of the directory, recurse 6 levels
//   tree      — alphabetical, immediate children only (FolderTree fetches
//               deeper levels lazily via a fresh getRenderTree(subCursor))
export function assembleRenderTree(
	slice: RenderSlice,
	cursor: string[],
	drive: ScanDrive | null,
): Ob.RenderTree {
	return {
		name: drive?.name ?? slice.name,
		cursor,
		type: "directory",
		rootCapacity: drive?.capacity || slice.rootSize,
		rootSize: slice.rootSize,
		// Only the root has a capacity of its own: the drive's.
		capacity: (cursor.length === 0 && drive?.capacity) || slice.size,
		position: slice.position,
		size: slice.size,
		list: { files: slice.list },
		sunburst: { files: slice.sunburst },
		tree: {
			files: slice.list
				.slice()
				.sort((a, b) =>
					a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
				),
		},
	};
}
