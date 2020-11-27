// Handle initial platform setup before we do any heavy lifting
import "./platform/windows";

import * as drivelist from "drivelist";
import { app, BrowserWindow } from "electron";
import path from "path";
import url from "url";

import {
	dispatch,
	premountVfs,
	propagateDriveList,
	render,
	store,
} from "../store/main";
import "./system/menu";
import navigation from "./system/navigation";
import "./system/theme";
import touchbar from "./system/touchbar";
import { VirtualFileSystem } from "./vfs";

import * as telescope from "telescope";

console.log("neon: ", telescope.hello());

let smsr = false;
let view: BrowserWindow = null;

const scans = new Map<string, VirtualFileSystem>();

store.subscribe(() => {
	console.log("checking for new inits");
	const { vfs } = store.getState();

	// another reason that immer sucks
	// we have to copy to make it iterable
	const copy = new Map(vfs);

	// TypeScript is yelling about something dumb
	// for (const [path, scan] of vfs) {
	// }

	copy.forEach((scan, path) => {
		console.log(
			"checking",
			path,
			// May or may not add a function like this to the next release of
			// electron-redux
			Object.fromEntries(
				Object.entries(scan).filter(([key]) => key !== "currentTree"),
			),
		);
		if (scan.status === "init") {
			scans.set(path, new VirtualFileSystem(path));
			dispatch(premountVfs(path));
		} else if (scan.status === "complete" && scan.outOfDate) {
			const vfs = scans.get(path);
			dispatch(render(path, scan.cursor, vfs.getRenderTree(scan.cursor)));
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
	view.on("ready-to-show", async () => {
		view.show();
		// Look up drives and propagate them in Redux
		const drives = await drivelist.list();
		dispatch(propagateDriveList(drives));
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
