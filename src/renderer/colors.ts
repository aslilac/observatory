// Map each top-level entry to a hue placed around the colour wheel by
// cumulative byte position. Files arrive size-desc, so the biggest entry
// gets the widest wedge of the hue range and the rainbow wraps the full
// 0..360 around the sunburst circle. Returned hues are at the angular
// midpoint of each entry's slice so the colour reads as "centered" on the
// wedge.
export function huesByPosition(files: Ob.VfsNode[]): Map<string, number> {
	const map = new Map<string, number>();
	const total = files.reduce((s, f) => s + f.size, 0);
	if (total === 0) return map;
	let bytes = 0;
	for (const file of files) {
		map.set(file.name, ((bytes + file.size / 2) / total) * 360);
		bytes += file.size;
	}
	return map;
}

export function oklchSwatch(hue: number): string {
	return `oklch(0.7 0.18 ${hue})`;
}

// Color for a sunburst arc. Layer adjusts lightness/chroma so deeper rings
// read as related but distinct. The `imaginary` type is the small-items
// remainder slice.
export function sunburstColor(
	hue: number,
	layer: number,
	type: Ob.NodeType$,
	dark: boolean,
): string {
	if (type === "imaginary") {
		return dark ? "oklch(0.28 0 0)" : "oklch(0.92 0 0)";
	}
	if (dark) {
		const l = Math.min(0.7, 0.48 + layer * 0.05);
		const c = Math.max(0.04, 0.16 - layer * 0.025);
		const fileShift = type === "file" ? -0.05 : 0;
		return `oklch(${(l + fileShift).toFixed(2)} ${c.toFixed(2)} ${hue})`;
	}
	const l = Math.min(0.94, 0.7 + layer * 0.05);
	const c = Math.max(0.05, 0.18 - layer * 0.025);
	const fileShift = type === "file" ? 0.05 : 0;
	return `oklch(${(l + fileShift).toFixed(2)} ${c.toFixed(2)} ${hue})`;
}
