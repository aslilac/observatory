// Handle initial platform setup before we do any heavy lifting
import "./platform/squirrel";

import { app } from "electron";
import "./system/menu";
import "./ipc";
import "./vfsManager";
import { createWindow } from "./viewManager";

// Launch on startup, quit when all windows are closed
app.on("ready", createWindow);
app.on("window-all-closed", app.quit);
