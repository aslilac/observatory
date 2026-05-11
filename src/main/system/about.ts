import { BrowserWindow, shell } from "electron";
import * as path from "node:path";

const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

let aboutWindow: BrowserWindow | null = null;

function showAboutWindow() {
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

export default showAboutWindow;
