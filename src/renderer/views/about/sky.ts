// The stars over the observatory, after the site's (site/src/stars.ts), but
// drawn once: each star with the trail a long exposure would give it, around
// the pole (the point the telescope is aimed at). Around the pole, the stars
// are only in three bands, and their trails take the colours of the sunburst
// on the telescope's mirror, by where they sit around it, so the sky draws
// the chart. A clear ring of sky sets it apart from the other stars.
//
// The canvas is centred on the pole, so about.css can turn it as the sky
// turns.

const TRAIL = (2 * Math.PI) / 7; // how far around the pole a trail reaches
const DENSITY = 1 / 1200; // stars per square pixel

// The mirror's sunburst: each top-level folder's hue, and its share of the
// circle, starting at the top and going clockwise, as on the icon. The bands
// are the chart's rings, as fractions of its radius.
const SECTORS: readonly (readonly [colour: string, share: number])[] = [
	["#5c9bff", 0.3],
	["#a585ff", 0.21],
	["#ff7db6", 0.18],
	["#ff9366", 0.16],
	["#ffcf4d", 0.11],
	["#9aa3b5", 0.04],
];
const BANDS: readonly (readonly [inner: number, outer: number])[] = [
	[0.2, 0.42],
	[0.48, 0.69],
	[0.75, 0.95],
];
// the clear ring around the chart, out to here (as a fraction of its radius)
const CLEAR = 1.18;

type Point = { x: number; y: number };

// The same sky every time the window opens.
function rng(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function sectorColour(theta: number): string {
	// clockwise from the top, in screen terms (y down)
	let f = ((theta + Math.PI / 2) / (2 * Math.PI)) % 1;
	if (f < 0) {
		f += 1;
	}
	for (const [colour, share] of SECTORS) {
		if (f < share) {
			return colour;
		}
		f -= share;
	}
	return SECTORS[0]![0];
}

// Fills `field` (the whole window) with the sky above `horizon`, turning
// around `pole`, with the chart `chart` px across from it.
export function drawStars(
	field: HTMLElement,
	pole: Point,
	horizon: number,
	chart: number,
): void {
	const { width } = field.getBoundingClientRect();
	// the radius of sky that can ever be seen, as it turns
	const R = Math.max(
		...[
			[0, 0],
			[width, 0],
			[0, horizon],
			[width, horizon],
		].map(([x, y]) => Math.hypot(x! - pole.x, y! - pole.y)),
	);
	const dpr = Math.min(devicePixelRatio || 1, 2);
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = Math.ceil(2 * R * dpr);
	Object.assign(canvas.style, {
		left: `${pole.x - R}px`,
		top: `${pole.y - R}px`,
		width: `${2 * R}px`,
		height: `${2 * R}px`,
	});
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	ctx.setTransform(dpr, 0, 0, dpr, R * dpr, R * dpr);

	const rand = rng(7);
	const n = Math.round(Math.PI * R * R * DENSITY);
	const stars = [];
	for (let i = 0; i < n; i++) {
		const r = R * Math.sqrt(rand());
		const theta = rand() * 2 * Math.PI;
		const m = rand() ** 3; // most stars are faint
		const kind = rand();
		const tint = kind < 0.6 ? "#fff8e8" : kind < 0.85 ? "#d8e4ff" : "#ffdcb8";
		// in the chart, only the bands have stars, and their trails take the
		// sunburst's colours, bolder than the rest so the rings read. Then the
		// clear ring, and then the rest of the sky.
		const coloured = BANDS.some(([a, b]) => r > a * chart && r < b * chart);
		if (!coloured && r < CLEAR * chart) {
			continue;
		}
		stars.push({
			r,
			theta,
			size: 0.45 + 1.3 * m,
			alpha: 0.35 + 0.65 * m,
			colour: tint,
			trailColour: coloured ? sectorColour(theta) : tint,
			trailAlpha: coloured ? 0.55 + 0.45 * m : 0.3 * (0.35 + 0.65 * m),
			trailWidth: coloured ? 1.1 + 0.9 * m : 0.4 + 1.1 * m,
		});
	}

	for (const star of stars) {
		ctx.globalAlpha = star.alpha;
		ctx.fillStyle = star.colour;
		ctx.beginPath();
		ctx.arc(
			star.r * Math.cos(star.theta),
			star.r * Math.sin(star.theta),
			star.size / 2,
			0,
			2 * Math.PI,
		);
		ctx.fill();
	}

	// the trails, in short pieces, fainter toward their tails. The stars turn
	// anticlockwise, so a trail runs back clockwise from each one.
	ctx.lineCap = "butt";
	ctx.globalCompositeOperation = "lighter"; // where trails cross, they glow
	const pieces = 48;
	for (let i = 0; i < pieces; i++) {
		const from = (i / pieces) * TRAIL;
		const to = ((i + 1) / pieces) * TRAIL;
		const fade = (1 - (i + 0.5) / pieces) ** 1.6;
		for (const star of stars) {
			ctx.globalAlpha = star.trailAlpha * fade;
			ctx.strokeStyle = star.trailColour;
			ctx.lineWidth = star.trailWidth;
			ctx.beginPath();
			ctx.arc(0, 0, star.r, star.theta + from, star.theta + to, false);
			ctx.stroke();
		}
	}

	field.append(canvas);
}
