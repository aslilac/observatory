// Categorical palette for top-level slice / dot color. Hues are spaced
// across the wheel so neighbors stay distinguishable; the design uses these
// or close to them. Lightness/chroma are constant (oklch) so colors read as
// equally weighted against paper.
const HUE_TABLE = [140, 280, 200, 0, 30, 320, 60, 240, 100, 180, 240, 90];

export function hueFor(index: number): number {
	return HUE_TABLE[index % HUE_TABLE.length]!;
}

export function oklchSwatch(hue: number): string {
	return `oklch(0.7 0.18 ${hue})`;
}

// Slightly lighter shade for outer-ring children in the sunburst.
export function oklchOuter(hue: number, jitter = 0): string {
	return `oklch(0.78 0.16 ${hue + jitter})`;
}

// Color for a sunburst arc. `hue` is from `hueFor(topLevelIndex)` so the dot
// in the legend list and the corresponding wedge in the sunburst share a
// hue. Layer adjusts lightness/chroma so deeper rings read as related but
// distinct. The `imaginary` type is the small-items remainder slice.
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
