// The sky over the observatory: stars turning around the pole (the point the
// telescope is aimed at), each with a trail behind it, like a long exposure.
// Around the pole, the stars are only in three bands, and their trails take the
// colours of the sunburst on the telescope's mirror, by where they sit around it,
// so the sky there is the chart. A clear ring of sky sets it apart from the other
// stars.
//
// Every star turns with the sky, so the stars and their trails are drawn on one
// canvas centred on the pole, and the browser's compositor turns it with a CSS
// animation, without the page drawing anything per frame. The trails are drawn
// once, at their full length, fading toward the tail, and after that the page
// does nothing.

const PERIOD = 480_000; // ms for the sky to turn once: eight minutes
const TRAIL = (2 * Math.PI) / 8; // how long a trail is, at the pole
// A trail the same angle everywhere is longest at the edge of the sky, so the
// angle narrows going out: at the edge it's this much of TRAIL.
const TRAIL_AT_EDGE = 0.5;
const TRAIL_PIECES = 48; // a trail is drawn in this many, each fainter than the last
const DENSITY = 1 / 3750; // stars per square pixel

// The sky moves less than a pixel in a thirtieth of a second, even at the corners,
// so it turns in steps, 30 a second, rather than at the display's rate (120 on a
// ProMotion screen), and the frames between steps have nothing to draw.
const STEPS = 30 / 1000; // a millisecond

// The mirror's sunburst: each top-level folder's hue, and its share of the circle,
// starting at the top and going clockwise, as on the icon. The bands are the
// chart's rings, as fractions of CHART (of the scene's height).
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
const CHART = 0.62;
// the clear ring around the chart, out to here (as a fraction of CHART)
const CLEAR = 1.18;

interface Star {
	r: number;
	theta: number;
	size: number;
	alpha: number;
	colour: string;
	trail: number; // the angle its trail covers
	trailColour: string;
	trailAlpha: number;
	trailWidth: number;
}

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
	if (f < 0) f += 1;
	for (const [colour, share] of SECTORS) {
		if (f < share) return colour;
		f -= share;
	}
	return SECTORS[0]![0];
}

function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d canvas");
	return ctx;
}

function sky(hero: HTMLElement, scene: HTMLElement, field: HTMLElement): void {
	const still = matchMedia("(prefers-reduced-motion: reduce)");

	// the sky, centred on the pole: a canvas with the stars and their trails
	const turning = document.createElement("div");
	const skyCanvas = document.createElement("canvas");
	const skyCtx = canvas2d(skyCanvas);
	turning.append(skyCanvas);
	field.append(turning);

	// anticlockwise, as around the north pole
	const turn = turning.animate(
		[{ transform: "rotate(0turn)" }, { transform: "rotate(-1turn)" }],
		{
			duration: PERIOD,
			iterations: Infinity,
			easing: `steps(${Math.round(PERIOD * STEPS)})`,
		},
	);

	let stars: Star[] = [];
	let laidOut = "";

	function layout(): void {
		const h = hero.getBoundingClientRect();
		const s = scene.getBoundingClientRect();
		laidOut = `${h.width}x${h.height}`;
		const dpr = Math.min(devicePixelRatio || 1, 2);
		const pole = {
			x: s.left - h.left + Number(scene.dataset["poleX"]) * s.width,
			y: s.top - h.top + Number(scene.dataset["poleY"]) * s.height,
		};
		// the stars set into the haze above the horizon (a mask, in the CSS)
		const horizonY =
			s.top - h.top + Number(scene.dataset["horizon"]) * s.height;
		field.style.setProperty("--horizon-y", `${horizonY}px`);

		// the radius of sky that can ever be seen
		const corners = [
			[0, 0],
			[h.width, 0],
			[0, horizonY],
			[h.width, horizonY],
		] as const;
		const R = Math.max(
			...corners.map(([x, y]) => Math.hypot(x - pole.x, y - pole.y)),
		);
		Object.assign(turning.style, {
			left: `${pole.x - R}px`,
			top: `${pole.y - R}px`,
			width: `${2 * R}px`,
			height: `${2 * R}px`,
		});

		// the sky canvas: as sharp as the screen, unless that gets too big
		const skyScale = Math.min(dpr, 4096 / (2 * R));
		skyCanvas.width = skyCanvas.height = Math.ceil(2 * R * skyScale);
		skyCtx.setTransform(skyScale, 0, 0, skyScale, R * skyScale, R * skyScale);

		// stars, spread evenly over the disc of sky
		const rand = rng(7);
		const chart = CHART * s.height;
		const n = Math.round(Math.PI * R * R * DENSITY);
		stars = [];
		for (let i = 0; i < n; i++) {
			const r = R * Math.sqrt(rand());
			const theta = rand() * 2 * Math.PI;
			const m = rand() ** 3; // most stars are faint
			const kind = rand();
			const tint = kind < 0.6 ? "#fff8e8" : kind < 0.85 ? "#d8e4ff" : "#ffdcb8";
			// in the chart, only the bands have stars, and their trails take the
			// sunburst's colours, drawn bolder than the rest so the rings read. Then
			// the clear ring, and then the rest of the sky.
			const coloured = BANDS.some(([a, b]) => r > a * chart && r < b * chart);
			if (!coloured && r < CLEAR * chart) continue;
			stars.push({
				r,
				theta,
				size: 0.45 + 1.3 * m,
				alpha: 0.35 + 0.65 * m,
				colour: tint,
				trail: TRAIL * (1 - (1 - TRAIL_AT_EDGE) * (r / R)),
				trailColour: coloured ? sectorColour(theta) : tint,
				trailAlpha: coloured ? 0.55 + 0.45 * m : 0.3 * (0.35 + 0.65 * m),
				trailWidth: coloured ? 1.1 + 0.9 * m : 0.4 + 1.1 * m,
			});
		}
		for (const st of stars) {
			skyCtx.globalAlpha = st.alpha;
			skyCtx.fillStyle = st.colour;
			skyCtx.beginPath();
			skyCtx.arc(
				st.r * Math.cos(st.theta),
				st.r * Math.sin(st.theta),
				st.size / 2,
				0,
				2 * Math.PI,
			);
			skyCtx.fill();
		}
		skyCtx.globalAlpha = 1;

		for (let i = 0; i < TRAIL_PIECES; i++) {
			paintTrails(i / TRAIL_PIECES, (i + 1) / TRAIL_PIECES);
		}
	}

	// a piece of every star's trail (from and to are fractions of its length),
	// fainter the further back it is
	function paintTrails(from: number, to: number): void {
		const fade = (1 - (from + to) / 2) ** 1.6;
		skyCtx.lineCap = "butt";
		skyCtx.globalCompositeOperation = "lighter"; // where trails cross, they glow
		for (const st of stars) {
			skyCtx.globalAlpha = st.trailAlpha * fade;
			skyCtx.strokeStyle = st.trailColour;
			skyCtx.lineWidth = st.trailWidth;
			skyCtx.beginPath();
			// the stars turn anticlockwise, so a trail runs back clockwise from each one
			skyCtx.arc(
				0,
				0,
				st.r,
				st.theta + from * st.trail,
				st.theta + to * st.trail,
				false,
			);
			skyCtx.stroke();
		}
		skyCtx.globalAlpha = 1;
		skyCtx.globalCompositeOperation = "source-over";
	}

	// the sky turns while the hero is in view, unless motion is turned down
	let inView = true;
	function update(): void {
		if (inView && !still.matches) {
			turn.play();
		} else {
			turn.pause();
		}
	}

	layout();
	update();

	// redo the sky when the hero changes size
	let resizeTimer: ReturnType<typeof setTimeout> | undefined;
	new ResizeObserver(() => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			const h = hero.getBoundingClientRect();
			if (`${h.width}x${h.height}` === laidOut) return;
			layout();
			update();
		}, 100);
	}).observe(hero);
	new IntersectionObserver(([entry]) => {
		inView = entry?.isIntersecting ?? true;
		update();
	}).observe(hero);
	still.addEventListener("change", update);
}

const hero = document.querySelector<HTMLElement>(".hero");
const scene = hero?.querySelector<HTMLElement>(".scene");
const field = hero?.querySelector<HTMLElement>(".stars");
if (hero && scene && field) sky(hero, scene, field);
