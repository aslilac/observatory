// The site's hero, small: the render of the observatory across the bottom of
// the window (site/scene/about.py crops it), and the sky behind it, laid out
// by where the horizon, the sun and the pole fall on it.
import layout from "../../../../build-resources/about/scene.json";
import { version } from "../../../../package.json";
import scene from "../../../../build-resources/about/scene.webp";
import { drawStars } from "./sky";

const width = innerWidth;
const sceneHeight = width / layout.aspect;
const sceneTop = innerHeight - sceneHeight;
const at = ([x, y]: number[]) => ({
	x: x! * width,
	y: sceneTop + y! * sceneHeight,
});
const sun = at(layout.sun);
const pole = at(layout.pole);
const horizon = sceneTop + layout.horizon * sceneHeight;
// The sky is sized by the whole render, as it is on the site.
const renderWidth = layout.render[0]! * width;
const renderHeight = layout.render[1]! * sceneHeight;

const root = document.documentElement.style;
root.setProperty("--scene-h", `${sceneHeight}px`);
root.setProperty("--render-w", `${renderWidth}px`);
root.setProperty("--render-h", `${renderHeight}px`);
root.setProperty("--horizon-y", `${horizon}px`);
root.setProperty("--sun-x", `${sun.x}px`);
root.setProperty("--sun-y", `${sun.y}px`);

// Main hands over what this copy is and what it's on (environment.ts).
// Opened some other way, there's just the version it was built as.
const environment = readEnvironment();

const versionLabel = document.querySelector<HTMLElement>(".version");
if (versionLabel) {
	versionLabel.textContent = environment?.version ?? version;
}

const list = document.querySelector<HTMLElement>(".details");
const copy = document.querySelector<HTMLButtonElement>(".copy");
if (environment && list && copy) {
	for (const { label, value } of environment.details) {
		const term = document.createElement("dt");
		term.textContent = label;
		const description = document.createElement("dd");
		description.textContent = value;
		description.title = value;
		list.append(term, description);
	}
	// As it'd go in a bug report.
	const text = [
		{ label: "Version", value: environment.version },
		...environment.details,
	]
		.map(({ label, value }) => `${label}: ${value}`)
		.join("\n");
	copy.hidden = false;
	copy.addEventListener("click", () => {
		void navigator.clipboard.writeText(text).then(() => {
			copy.textContent = "Copied";
			setTimeout(() => {
				copy.textContent = "Copy";
			}, 1500);
		});
	});
}

// The stars dim behind the words, which the list makes taller. The blocks
// span the window, so it's their text that's measured.
const words = [...document.querySelectorAll<HTMLElement>("main > *")]
	.filter((element) => !element.hidden)
	.map((element) => {
		const range = document.createRange();
		range.selectNodeContents(element);
		return range.getBoundingClientRect();
	});
if (words.length > 0) {
	const top = words[0]!.top;
	const bottom = words.at(-1)!.bottom;
	const left = Math.min(...words.map((rect) => rect.left));
	const right = Math.max(...words.map((rect) => rect.right));
	root.setProperty("--words-x", `${(left + right) / 2}px`);
	root.setProperty("--words-y", `${(top + bottom) / 2}px`);
	root.setProperty("--words-rx", `${0.9 * (right - left)}px`);
	root.setProperty("--words-ry", `${0.85 * (bottom - top)}px`);
}

function readEnvironment(): Ob.Environment | null {
	const query = new URLSearchParams(location.search).get("environment");
	try {
		return query ? (JSON.parse(query) as Ob.Environment) : null;
	} catch {
		return null;
	}
}

const img = document.querySelector<HTMLImageElement>(".scene");
if (img) {
	img.src = scene;
}
const field = document.querySelector<HTMLElement>(".stars");
if (field) {
	// the chart in the sky is as big, for the render, as on the site
	drawStars(field, pole, horizon, 0.62 * renderHeight);
}
