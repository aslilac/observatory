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
