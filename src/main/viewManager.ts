import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	screen,
} from "electron";
import * as path from "node:path";

// electron-vite sets this during development with the URL of the Vite dev
// server. Empty in packaged builds — use the bundled HTML on disk instead.
const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

export const windowSettings: BrowserWindowConstructorOptions = {
	minWidth: 1080,
	minHeight: 800,
	show: false,
	titleBarStyle: "hiddenInset",
	autoHideMenuBar: true,
	webPreferences: {
		contextIsolation: true,
		preload: path.join(__dirname, "../preload/index.js"),
	},
};

export function createWindow() {
	// Create the browser window.
	const view = new BrowserWindow(windowSettings);

	// Load the app — Vite dev server in dev, bundled HTML in prod.
	if (RENDERER_DEV_URL) {
		void view.loadURL(RENDERER_DEV_URL);
	} else {
		void view.loadFile(path.join(__dirname, "../renderer/index.html"));
	}

	// Prevent seeing an unpopulated screen.
	view.on("ready-to-show", () => {
		view.show();
	});

	const sendNav = (direction: "back" | "forward") => {
		view.webContents.send("ob:nav", direction);
	};

	// Mouse back/forward buttons.
	view.on("app-command", (_event, command) => {
		if (command === "browser-backward") sendNav("back");
		else if (command === "browser-forward") sendNav("forward");
	});

	// Two-finger swipe on macOS.
	view.on("swipe", (_event, direction) => {
		if (direction === "left") sendNav("back");
		else if (direction === "right") sendNav("forward");
	});
}
