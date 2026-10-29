import { hueForRange, sunburstColor } from "#/colors";
import { joinPath } from "#/paths";
import type { ReservedGroup } from "./reserved";
import { isDrawable } from "./sunburstGeometry";
import type { SelectableItem } from "./types";

const MAX_LAYER = 6;

// Where a wedge is: from `x0` to `x1` turns around the circle, in ring
// `layer` (fractional while it's moving between rings).
export type Arc = { x0: number; x1: number; layer: number };

export type Wedge = {
	// The same wherever the sunburst is centered, so a wedge can be followed
	// from one folder's view to the next.
	key: string;
	arc: Arc;
	// Absolute depth below the scan root, for color.
	depth: number;
	type: Ob.NodeType$;
	fill: string;
	file: Ob.VfsNode;
	// Below the current folder, what clicking the wedge opens.
	path: string[];
	// Set when it's a file or folder's own wedge, rather than reserved space
	// or the rest of a folder: what its menu and dragging it act on.
	item?: SelectableItem;
	// Set when it's one of the reserved wedges, which `file` only names.
	reserved?: ReservedGroup;
	// Faded when this is in cleanup, or inside something that is.
	cleanupPath?: string;
};

// The key of the wedge for whatever is at `names` below the scan `root`.
export function wedgeKey(root: string, names: string[]): string {
	return [root, ...names].join("\0");
}

export type LayoutInput = {
	root: string;
	cursor: string[];
	files: Ob.VfsNode[];
	// What a full turn stands for: the folder's size, or the disk's capacity
	// at the root of a whole-disk scan.
	capacity: number;
	size: number;
	rootSize: number;
	// See `Sunburst`'s `position`.
	position: number;
	reserved: ReservedGroup[];
	dark: boolean;
};

// Every wedge the sunburst draws for the folder at `cursor`.
export function layoutWedges(input: LayoutInput): Wedge[] {
	const { root, cursor, capacity, size, reserved, dark } = input;
	const wedges: Wedge[] = [];
	const basePath = joinPath(root, ...cursor);
	layoutRing(input, basePath, wedges, input.files, 0, 0, input.position, []);

	let reservedPos = size / capacity;
	for (const group of reserved) {
		// Kept inside the circle should the capacity be unknown.
		const share = Math.min(group.size / capacity, 1 - reservedPos);
		if (isDrawable(share, 0)) {
			wedges.push({
				key: `${wedgeKey(root, [])}\0reserved\0${group.kind}`,
				arc: { x0: reservedPos, x1: reservedPos + share, layer: 0 },
				depth: cursor.length,
				type: "reserved",
				fill: sunburstColor(0, cursor.length, "reserved", dark),
				file: { type: "file", name: group.label, size: group.size, mtime: 0 },
				path: [],
				reserved: group,
			});
		}
		reservedPos += share;
	}
	return wedges;
}

function layoutRing(
	input: LayoutInput,
	basePath: string,
	wedges: Wedge[],
	nodes: Ob.VfsNode[],
	layer: number,
	startPos: number,
	// Where this run of siblings starts in hue space, as a fraction of
	// rootSize. Tracked separately from startPos because the arc geometry is
	// scaled to the current directory's capacity while hues stay anchored to
	// the scan root.
	hueStart: number,
	parentPath: string[],
) {
	const { root, cursor, capacity, rootSize, dark } = input;
	const depth = cursor.length + layer;
	let pos = startPos;
	let huePos = hueStart;
	for (const file of nodes) {
		const sliceSize = file.size / capacity;
		const hueSize = file.size / rootSize;
		// Hues follow every sibling's bytes, drawn or not, to match the legend.
		const fileHuePos = huePos;
		huePos += hueSize;
		if (!isDrawable(sliceSize, layer)) {
			continue;
		}
		const hue = hueForRange(fileHuePos, hueSize);
		const path = [...parentPath, file.name];
		const key = wedgeKey(root, [...cursor, ...path]);
		const fullPath = joinPath(basePath, ...path);

		wedges.push({
			key,
			arc: { x0: pos, x1: pos + sliceSize, layer },
			depth,
			type: file.type,
			fill: sunburstColor(hue, depth, file.type, dark),
			file,
			path,
			item: {
				path: fullPath,
				name: file.name,
				size: file.size,
				type: file.type === "directory" ? "directory" : "file",
			},
			cleanupPath: fullPath,
		});

		if (file.type === "directory" && layer < MAX_LAYER) {
			if (file.files.length > 0) {
				layoutRing(
					input,
					basePath,
					wedges,
					file.files,
					layer + 1,
					pos,
					fileHuePos,
					path,
				);
			}

			// The rest of the directory goes in one gray wedge: children too
			// small to draw, whether they were dropped here or by the scanner
			// (src/scanner/tree.rs), which leaves no trace of them.
			const childrenSum = file.files
				.map((f) => f.size / capacity)
				.filter((s) => isDrawable(s, layer + 1))
				.reduce((sum, s) => sum + s, 0);
			const remainder = sliceSize - childrenSum;
			if (layer < 4 && isDrawable(remainder, layer + 1)) {
				wedges.push({
					key: `${key}\0rest`,
					arc: {
						x0: pos + childrenSum,
						x1: pos + sliceSize,
						layer: layer + 1,
					},
					depth: depth + 1,
					type: "imaginary",
					fill: sunburstColor(hue, depth + 1, "imaginary", dark),
					file,
					path,
					cleanupPath: fullPath,
				});
			}
		}

		pos += sliceSize;
	}
}
