// Handle initial platform setup before we do any heavy lifting
import "./platform/windows";

// import { stopForwarding } from "@mckayla/electron-redux";
import * as drivelist from "drivelist";
import { app, BrowserWindow } from "electron";
import path from "path";
import url from "url";

import { premountVfs, propagateDriveList, store } from "../store/main";
import "./system/menu";
import navigation from "./system/navigation";
import "./system/theme";
import touchbar from "./system/touchbar";
import { VirtualFileSystem } from "./vfs";

let smsr = false;
let view: BrowserWindow = null;

// TODO: Get rid of this for @mckayla/electron-redux 2.0.1
export const stopForwarding = <T extends { meta?: object }>(action: T) => ({
	...action,
	meta: {
		...action.meta,
		scope: "local" as const,
	},
});

store.subscribe(() => {
	console.log("checking for new inits");
	const { vfs } = store.getState();

	// another reason that immer sucks
	const copy = new Map(vfs);

	copy.forEach((scan, path) => {
		console.log("checking", scan, path);
		if (scan.status === "init") {
			store.dispatch(
				stopForwarding(premountVfs(path, new VirtualFileSystem(path))),
			);
		}
	});
});

const createWindow = async () => {
	// Create the browser window.
	view = new BrowserWindow({
		width: 1100,
		height: 800,
		show: false,
		titleBarStyle: "hiddenInset",
		autoHideMenuBar: true,
		webPreferences: {
			nodeIntegration: true,
		},
	});

	// Source map support
	// We put it here because we need to await it, and can't at top level.
	// Putting it here ensures we don't go very far without it in development.
	if (!smsr && !app.isPackaged) {
		await import("source-map-support/register");
		smsr = true;
	}

	// REPL!
	// This also super-breaks launching on macOS when packaged and doesn't
	// work on Windows literally ever. It also breaks when running inside of
	// forge, and basically all the time.
	// if (process.platform === "darwin" && !app.isPackaged) {
	// 	const repl = require("repl");
	// 	const x = repl.start({
	// 		prompt: "> ",
	// 		useGlobal: true,
	// 	});
	// 	Object.assign(x.context, {
	// 		view,
	// 	});
	// 	x.on("exit", () => app.quit());
	// }

	// Load the app.
	view.loadURL(
		url.format({
			pathname: path.join(__dirname, "../renderer/index.html"),
			protocol: "file:",
			slashes: true,
		}),
	);

	// Prevent seeing an unpopulated screen.
	view.on("ready-to-show", () => {
		view.show();
		// Look up drives and propagate them in Redux
		drivelist.list().then((drives) => {
			store.dispatch(propagateDriveList(drives));
		});
	});

	// Emitted when the window is closed.
	view.on("closed", () => {
		// Dereference the window object, so that Electron can close gracefully
		view = null;
	});

	// Attach everything to the window.
	navigation.init(view);
	touchbar.init(view);
};

// Launch on startup.
app.on("ready", () => {
	createWindow();
});

app.on("window-all-closed", () => {
	app.quit();
});