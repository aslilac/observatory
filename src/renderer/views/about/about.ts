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

const versionLabel = document.querySelector<HTMLElement>(".version");
if (versionLabel) {
	versionLabel.textContent = version;
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
