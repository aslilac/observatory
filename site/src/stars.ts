// The sky over the observatory: stars turning around the pole (the point the
// telescope is aimed at), each drawing a trail as it goes, like a long exposure
// that started when the page opened. Around the pole, the stars are only in three
// bands, and their trails take the colours of the sunburst on the telescope's
// mirror, by where they sit around it, so the longer you stay, the more the sky
// becomes the chart. A clear ring of sky sets it apart from the other stars.
//
// Every star turns with the sky, so the stars and their trails are drawn on one
// canvas centred on the pole, and the browser's compositor turns it with a CSS
// animation, without the page drawing anything per frame. The trails grow a few
// times a second until they're full length (at their tail ends, fainter as they
// get longer, so they fade toward the tail), and after that the page does nothing.
//
// ?exposure=120 starts the page as if it had been open for 120 seconds.

const PERIOD = 480_000; // ms for the sky to turn once: eight minutes
const TURN = (2 * Math.PI) / PERIOD; // radians a millisecond
const TRAIL_MAX = (2 * Math.PI) / 7; // the longest a trail gets
const DENSITY = 1 / 3000; // stars per square pixel
const GROW_EVERY = 250; // ms between growing the trails

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
	const params = new URLSearchParams(location.search);
	const exposure = 1000 * Number(params.get("exposure") ?? 0);

	// the sky, centred on the pole: a canvas with the stars and their trails
	const turning = document.createElement("div");
	const skyCanvas = document.createElement("canvas");
	const skyCtx = canvas2d(skyCanvas);
	turning.append(skyCanvas);
	field.append(turning);

	// anticlockwise, as around the north pole. Its time is how long the sky has
	// been exposed, which stops while the hero is out of view.
	const turn = turning.animate(
		[{ transform: "rotate(0turn)" }, { transform: "rotate(-1turn)" }],
		{
			duration: PERIOD,
			iterations: Infinity,
			easing: `steps(${Math.round(PERIOD * STEPS)})`,
		},
	);
	turn.currentTime = exposure;
	const clock = (): number => Number(turn.currentTime ?? 0);

	let stars: Star[] = [];
	let trail = 0; // how long the trails are on the sky canvas so far
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
				trailColour: coloured ? sectorColour(theta) : tint,
				trailAlpha: coloured ? 0.55 + 0.45 * m : 0.3 * (0.35 + 0.65 * m),
				trailWidth: coloured ? 1.1 + 0.9 * m : 0.4 + 1.1 * m,
			});
		}
		trail = 0;
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

		growTrails(exposed());
	}

	// grow the trails on the sky canvas out to `to`: each new piece at the tail,
	// fainter, in short pieces so a long jump (a resize, ?exposure) still fades
	function growTrails(to: number): void {
		while (to > trail + 1e-4) {
			const next = Math.min(to, trail + TRAIL_MAX / 48);
			paintTrails(trail, next);
			trail = next;
		}
	}

	function paintTrails(from: number, to: number): void {
		const fade = (1 - (from + to) / 2 / TRAIL_MAX) ** 1.6;
		skyCtx.lineCap = "butt";
		skyCtx.globalCompositeOperation = "lighter"; // where trails cross, they glow
		for (const st of stars) {
			skyCtx.globalAlpha = st.trailAlpha * fade;
			skyCtx.strokeStyle = st.trailColour;
			skyCtx.lineWidth = st.trailWidth;
			skyCtx.beginPath();
			// the stars turn anticlockwise, so a trail runs back clockwise from each one
			skyCtx.arc(0, 0, st.r, st.theta + from, st.theta + to, false);
			skyCtx.stroke();
		}
		skyCtx.globalAlpha = 1;
		skyCtx.globalCompositeOperation = "source-over";
	}

	function exposed(): number {
		return Math.min(TRAIL_MAX, TURN * clock());
	}

	// while the sky turns and the trails aren't full length, grow them now and then
	let grower: ReturnType<typeof setInterval> | undefined;
	function stopGrowing(): void {
		clearInterval(grower);
		grower = undefined;
	}
	function keepGrowing(): void {
		if (grower !== undefined || trail >= TRAIL_MAX - 1e-4) return;
		grower = setInterval(() => {
			growTrails(exposed());
			if (trail >= TRAIL_MAX - 1e-4) stopGrowing();
		}, GROW_EVERY);
	}

	// the sky turns while the hero is in view, unless motion is turned down
	let inView = true;
	function update(): void {
		if (inView && !still.matches) {
			turn.play();
			keepGrowing();
		} else {
			turn.pause();
			stopGrowing();
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
