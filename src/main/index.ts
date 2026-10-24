// Handle initial platform setup before we do any heavy lifting
import "./platform/squirrel";

import { app } from "electron";
import { scanArgument } from "./elevation";
import "./menu";
import "./ipc";
import { startScan } from "./vfsManager";
import { createWindow } from "./viewManager";

// Launch on startup, quit when all windows are closed. A copy started with
// --scan=<path> (see elevation.ts) opens straight into a scan of it.
app.on("ready", () => {
	const scan = scanArgument();
	if (scan) {
		startScan(scan);
	}
	createWindow(scan);
});
app.on("window-all-closed", app.quit);
