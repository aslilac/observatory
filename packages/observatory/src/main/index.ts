// Handle initial platform setup before we do any heavy lifting
import "./platform/squirrel";

import { app } from "electron";

import "./platform/macOS";
import "./system/menu";
import "./system/theme";
import "./ipcBindings";
import "./vfsManager";
import { createWindow } from "./viewManager";

// For testing telescope development
import "./telescope";

// Launch on startup.
app.on("ready", () => {
	createWindow();
});

app.on("window-all-closed", () => {
	app.quit();
});
