import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	nativeTheme,
	shell,
	type TitleBarOverlayOptions,
} from "electron";
import * as path from "node:path";

// electron-vite sets this during development with the URL of the Vite dev
// server. Empty in packaged builds — use the bundled HTML on disk instead.
const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

// On Windows and Linux the window has no title bar of its own, only the
// renderer's (TitleBar in Application.tsx), with the minimize / maximize /
// close buttons drawn over it, as VS Code does: at its right end on Windows,
// and wherever the desktop puts them on Linux. They're drawn in the app's
// theme rather than the OS's, so the renderer tells us when that changes
// (Ob.setTitleBarTheme). 35 tall leaves the title bar's 1px bottom border
// showing under them.
export function titleBarOverlay(
	theme: "light" | "dark",
): TitleBarOverlayOptions {
	// --color-background and --color-default in src/renderer/index.css.
	return theme === "dark"
		? { color: "#1a1a24", symbolColor: "#ececf2", height: 35 }
		: { color: "#f9f9fd", symbolColor: "#191923", height: 35 };
}

function windowSettings(): BrowserWindowConstructorOptions {
	return {
		minWidth: 1080,
		minHeight: 800,
		show: false,
		// macOS draws the traffic lights over the renderer's title bar itself.
		// Elsewhere, until the renderer says which theme it's in, guess the
		// OS's, which it follows unless the user picked one.
		...(process.platform === "darwin"
			? { titleBarStyle: "hiddenInset" }
			: {
					titleBarStyle: "hidden",
					titleBarOverlay: titleBarOverlay(
						nativeTheme.shouldUseDarkColors ? "dark" : "light",
					),
				}),
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, "../preload/index.js"),
		},
	};
}

export function createWindow() {
	// Create the browser window.
	const view = new BrowserWindow(windowSettings());

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
		view.webContents.send("Ob.nav", direction);
	};

	// Mouse back/forward buttons.
	view.on("app-command", (_event, command) => {
		if (command === "browser-backward") {
			sendNav("back");
		} else if (command === "browser-forward") {
			sendNav("forward");
		}
	});

	// Two-finger swipe on macOS.
	view.on("swipe", (_event, direction) => {
		if (direction === "left") {
			sendNav("back");
		} else if (direction === "right") {
			sendNav("forward");
		}
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
		// It shows this platform's icon, and has no preload to ask with.
		const query = { platform: process.platform };
		if (RENDERER_DEV_URL) {
			void aboutWindow.loadURL(
				`${RENDERER_DEV_URL}/views/about/about.html?${new URLSearchParams(query)}`,
			);
		} else {
			void aboutWindow.loadFile(
				path.join(__dirname, "../renderer/views/about/about.html"),
				{ query },
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
