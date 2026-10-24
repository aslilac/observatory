// Hue placement is anchored to the scan root, not the current view: the root
// owns the full 0..360 range, and every directory splits its own range among
// its children in proportion to their sizes, largest first (scan order).
// Because each child's share of its parent's range equals its share of the
// parent's bytes, a node's range works out to its byte offset within the
// root over the root's size, which is what `start` / `size` are here (both
// fractions of the root). The hue sits at the midpoint of that range, so any
// given file or folder keeps the same hue wherever the sunburst is centered.
export function hueForRange(start: number, size: number): number {
	return (start + size / 2) * 360;
}

// Hues for the immediate children of a directory that begins at `start`
// (fraction of the root, i.e. RenderTree.position). `files` must be in scan
// order so the running offset matches the main process's position math.
export function huesByPosition(
	files: Ob.VfsNode[],
	start: number,
	rootSize: number,
): Map<string, number> {
	const map = new Map<string, number>();
	if (rootSize === 0) {
		return map;
	}
	let pos = start;
	for (const file of files) {
		const size = file.size / rootSize;
		map.set(file.name, hueForRange(pos, size));
		pos += size;
	}
	return map;
}

// The theme lives as a class on <html> (see useTheme). Read at render time;
// toggling re-renders the whole tree, so callers pick up the change.
export function isDarkTheme(): boolean {
	return document.documentElement.classList.contains("dark");
}

// Color for a sunburst arc (and the matching legend dots). Like the hue,
// `depth` is measured from the scan root rather than the current view, so a
// node looks identical wherever the sunburst is centered. Deeper folders
// recede toward the background — lighter on the light theme, darker on the
// dark one — and files are always the color they recede toward, at any
// depth. The `imaginary` type is the small-items remainder slice, and
// `reserved` is what Windows keeps for itself: both gray, the reserved one a
// step stronger, since it's space that's taken rather than a remainder.
export function sunburstColor(
	hue: number,
	depth: number,
	type: Ob.NodeType$,
	dark: boolean,
): string {
	if (type === "imaginary") {
		return dark ? "oklch(0.28 0.015 287)" : "oklch(0.92 0.012 287)";
	}
	if (type === "reserved") {
		return dark ? "oklch(0.42 0.012 287)" : "oklch(0.8 0.01 287)";
	}
	// Files skip straight to where folders are headed.
	const steps = type === "file" ? Infinity : depth;
	const l = dark ? recede(0.84, 0.68, steps) : recede(0.68, 0.9, steps);
	const c = dark ? recede(0.18, 0.1, steps) : recede(0.22, 0.09, steps);
	return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${hue})`;
}

// Move from `near` toward `far` as depth grows, closing a fifth of the
// remaining gap per level. Depth is unbounded now that it's absolute, so
// a linear ramp would clamp and wash out everything past a few levels; this
// keeps adjacent levels distinguishable however far the user has drilled in.
function recede(near: number, far: number, depth: number): number {
	return far + (near - far) * 0.8 ** depth;
}
