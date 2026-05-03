import {
	BrowserWindow,
	BrowserWindowConstructorOptions,
	screen,
} from "electron";
import * as path from "node:path";

// electron-vite injects this in dev mode pointing at the Vite dev server
// (e.g. http://localhost:5173). Empty in packaged builds — use the bundled
// HTML on disk instead.
const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

export const windowSettings: BrowserWindowConstructorOptions = {
	minWidth: 880,
	minHeight: 600,
	show: false,
	titleBarStyle: "hiddenInset",
	autoHideMenuBar: true,
	webPreferences: {
		contextIsolation: true,
		preload: path.join(__dirname, "../preload/index.js"),
	},
};

let view: BrowserWindow | null = null;

export function getCurrentView() {
	if (!view) {
		throw new Error("Attempting to read window object without an open window!");
	}

	return view;
}

export function createWindow() {
	if (view) {
		throw new Error("Attempting to open a new window when one already exists!");
	}

	// Create the browser window.
	view = new BrowserWindow(windowSettings);
	view.maximize();

	// Load the app — Vite dev server in dev, bundled HTML in prod.
	if (RENDERER_DEV_URL) {
		void view.loadURL(RENDERER_DEV_URL);
	} else {
		void view.loadFile(path.join(__dirname, "../renderer/index.html"));
	}

	// Prevent seeing an unpopulated screen.
	view.on("ready-to-show", () => {
		view!.show();
		view!.webContents.openDevTools();
	});

	// Emitted when the window is closed.
	view.on("closed", () => {
		// Dereference the window object, so that Electron can close gracefully
		view = null;
	});

	const sendNav = (direction: "back" | "forward") => {
		if (!view || view.isDestroyed()) return;
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
