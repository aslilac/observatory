import { BrowserWindow } from "electron";
import * as path from "node:path";

const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

let aboutWindow: BrowserWindow | null = null;

function showAboutWindow() {
	if (!aboutWindow) {
		aboutWindow = new BrowserWindow({
			backgroundColor: "#e73219",
			width: 800,
			height: 575,
			show: false,
			titleBarStyle: "hiddenInset",
			autoHideMenuBar: true,
			fullscreenable: false,
			minimizable: false,
			maximizable: false,
			resizable: false,
			alwaysOnTop: true,
		});

		// Load the about page — Vite dev server in dev, bundled HTML in prod.
		if (RENDERER_DEV_URL) {
			void aboutWindow.loadURL(`${RENDERER_DEV_URL}/about.html`);
		} else {
			void aboutWindow.loadFile(
				path.join(__dirname, "../renderer/about.html"),
			);
		}

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
