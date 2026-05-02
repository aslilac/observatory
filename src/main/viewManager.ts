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

export const windowSettings = (
	preload?: string,
): BrowserWindowConstructorOptions => ({
	x: 100,
	y: Math.floor(screen.getPrimaryDisplay().workArea.height / 8),
	width: 1100,
	minWidth: 880,
	height: 720,
	minHeight: 600,
	show: false,
	titleBarStyle: "hiddenInset",
	autoHideMenuBar: true,
	webPreferences: {
		contextIsolation: true,
		preload,
	},
});

export const devWindowSettings = (
	preload?: string,
): BrowserWindowConstructorOptions => ({
	x: 0,
	y: screen.getPrimaryDisplay().workArea.y,
	width: Math.min(1400, screen.getPrimaryDisplay().workArea.width),
	minWidth: 880,
	height: Math.min(880, screen.getPrimaryDisplay().workArea.height),
	minHeight: 600,
	show: false,
	titleBarStyle: "hiddenInset",
	autoHideMenuBar: true,
	webPreferences: {
		contextIsolation: true,
		preload,
	},
});

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
	view = new BrowserWindow(
		devWindowSettings(path.join(__dirname, "../preload/index.js")),
	);

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

	view.on("app-command", (event, command) => {
		const history = view!.webContents.navigationHistory;
		// Navigate the window back when the user hits their mouse back button
		if (command === "browser-backward" && history.canGoBack()) {
			history.goBack();
		} else if (command === "browser-forward" && history.canGoForward()) {
			history.goForward();
		}
	});

	view.on("swipe", (event, direction) => {
		const history = view!.webContents.navigationHistory;
		// Navigate the window back when the users swipe
		if (direction === "left" && history.canGoBack()) {
			history.goBack();
		} else if (direction === "right" && history.canGoForward()) {
			history.goForward();
		}
	});
}
