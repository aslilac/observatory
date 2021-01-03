// Handle initial platform setup before we do any heavy lifting
import "./platform/windows";

import { trimProperty } from "@mckayla/electron-redux";
import * as drivelist from "drivelist";
import { app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import path from "path";
import url from "url";

import {
	createVfs,
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
import { areMapsSimilar } from "./util";
import { VirtualFileSystem } from "./vfs";

import * as telescope from "telescope";

console.log("neon: ", telescope.hello());

ipcMain.handle("mckayla.observatory.SELECT_DIRECTORY", async () => {
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory"],
	});

	if (!result.canceled) {
		result.filePaths.forEach((selectedPath) => dispatch(createVfs(selectedPath)));
	}
});

ipcMain.handle("mckayla.observatory.SIZE_TO_DISPLAY", () => {
	// This shouldn't be able to happen, but handle it just in case
	if (!view) {
		return;
	}

	view.setMinimumSize(800, 600);

	const bounds = view.getBounds();
	const workArea = screen.getPrimaryDisplay().workArea;

	view.setSize(
		bounds.width,
		Math.max(bounds.height, 600, workArea.height - (bounds.y - workArea.y) * 2),
		true,
	);
});

ipcMain.handle("mckayla.observatory.SIZE_TO_MENU", () => {
	// This shouldn't be able to happen, but handle it just in case
	if (!view) {
		return;
	}

	view.setMinimumSize(800, 220);

	const bounds = view.getBounds();
	const state = store.getState();

	let menuItems = state.vfs.size;
	state.drives.forEach((drive) => !state.vfs.has(drive.mountPath) && menuItems++);

	view.setSize(bounds.width, Math.max(220, 150 + 72 * menuItems), true);
});

let smsr = false;
let view: BrowserWindow | null = null;

const scans = new Map<string, VirtualFileSystem>();

store.subscribe(() => {
	console.log("checking for new inits");
	// another reason that immer sucks
	// we have to copy to make it iterable
	const vfsState = new Map(store.getState().vfs);

	for (const [rootPath, scan] of vfsState) {
		console.log("checking", rootPath, trimProperty("currentTree", scan));

		if (scan.status === "init") {
			scans.set(rootPath, new VirtualFileSystem(rootPath));
			dispatch(premountVfs(rootPath));
		} else if (scan.status === "complete" && scan.outOfDate) {
			const vfs = scans.get(rootPath)!;
			dispatch(render(rootPath, scan.cursor, vfs.getRenderTree(scan.cursor)));
		}
	}
});

const createWindow = async () => {
	// Create the browser window.
	view = new BrowserWindow({
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
			preload: require.resolve("../preload"),
		},
	});

	view.id;

	// Source map support
	// We put it here because we need to await it, and can't at top level.
	// Putting it here ensures we don't go very far without it in development.
	if (!smsr && !app.isPackaged) {
		await import("source-map-support/register");
		smsr = true;
	}

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
		view!.show();
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

async function scanForDrives() {
	// console.log("updating drive list");

	// Look up drives and propagate them in Redux
	const driveList = await drivelist.list();
	const drives = new Map<string, Ob.PhysicalDrive>();

	driveList.forEach((device) =>
		device.mountpoints.forEach((mount) => {
			// Ignore system volumes on macOS
			if (
				process.platform == "darwin" &&
				mount.path.startsWith("/System/Volumes")
			) {
				return;
			}

			if (!drives.has(mount.path)) {
				drives.set(mount.path, {
					mountPath: mount.path,
					description: mount.label || `${mount.path} (${device.description})`,
				});
			}
		}),
	);

	// Don't dispatch if we don't need an update
	const currentDrives = store.getState().drives;
	if (!areMapsSimilar(currentDrives, drives)) {
		dispatch(propagateDriveList(drives));
	}
}

// Launch on startup.
app.on("ready", () => {
	setImmediate(scanForDrives);
	setInterval(scanForDrives, 5000);

	createWindow();
});

app.on("window-all-closed", () => {
	app.quit();
});
