import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	shell,
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

let aboutWindow: BrowserWindow | null = null;

export function showAboutWindow() {
	if (!aboutWindow) {
		aboutWindow = new BrowserWindow({
			// Match about.css's --color-background so the window doesn't flash
			// the system default while the renderer is loading.
			backgroundColor: "#12142d",
			width: 480,
			height: 540,
			show: false,
			titleBarStyle: "hiddenInset",
			autoHideMenuBar: true,
			fullscreenable: false,
			minimizable: false,
			maximizable: false,
			resizable: false,
		});

		// Load the about page — Vite dev server in dev, bundled HTML in prod.
		if (RENDERER_DEV_URL) {
			void aboutWindow.loadURL(`${RENDERER_DEV_URL}/views/about/about.html`);
		} else {
			void aboutWindow.loadFile(
				path.join(__dirname, "../renderer/views/about/about.html"),
			);
		}

		// Route external links (target=_blank or otherwise) to the user's
		// default browser instead of replacing the about page.
		aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
			void shell.openExternal(url);
			return { action: "deny" };
		});
		aboutWindow.webContents.on("will-navigate", (event, url) => {
			if (url !== aboutWindow?.webContents.getURL()) {
				event.preventDefault();
				void shell.openExternal(url);
			}
		});

		aboutWindow.on("closed", () => {
			aboutWindow = null;
		});

		aboutWindow.on("ready-to-show", () => {
			aboutWindow?.show();
		});
	} else {
		aboutWindow.show();
	}
}
