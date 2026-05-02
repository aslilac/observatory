import { BrowserWindow, BrowserWindowConstructorOptions, screen } from "electron";
import path from "path";
import url from "url";

import { initTouchBar } from "./system/touchbar";

export const windowSettings = (preload?: string): BrowserWindowConstructorOptions => ({
	x: 100,
	y: Math.floor(screen.getPrimaryDisplay().workArea.height / 8),
	width: 1100,
	minWidth: 800,
	height: 220,
	minHeight: 220,
	show: false,
	titleBarStyle: "hiddenInset",
	autoHideMenuBar: true,
	webPreferences: {
		contextIsolation: true,
		preload,
	},
});

export const devWindowSettings = (preload?: string): BrowserWindowConstructorOptions => ({
	x: 0,
	y: screen.getPrimaryDisplay().workArea.y,
	width: screen.getPrimaryDisplay().workArea.width,
	minWidth: 800,
	height: 220,
	minHeight: 220,
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
	view = new BrowserWindow(devWindowSettings(require.resolve("../preload")));

	// Load the app.
	view.loadURL(
		url.format({
			pathname: path.join(__dirname, "../renderer/index.html"),
			protocol: "file:",
			slashes: true,
		}),
	);

	// Make the touch bar manager aware of this window
	initTouchBar(view);

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
