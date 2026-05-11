import { app, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import * as fs from "node:fs/promises";

import { broadcast } from "./broadcast";
import { deleteFiles } from "./cleanup";
import { selectDirectory } from "./dialog";
import { setRecentScans } from "./system/menu";
import {
	cancelScan,
	getDrives,
	getRenderTree,
	getScanErrors,
	getScanPerfTree,
	getScans,
	getScanProgress,
	onDrivesChange,
	onScansChange,
	searchScan,
	startScan,
} from "./vfsManager";

// Drop the `event` arg most handlers don't care about — saves repeating the
// `(_event, ...args) => fn(...args)` boilerplate for every channel.
function pass<A extends unknown[], R>(fn: (...args: A) => R) {
	return (_event: IpcMainInvokeEvent, ...args: A) => fn(...args);
}

ipcMain.handle("ob:selectDirectory", pass(selectDirectory));
ipcMain.handle("ob:scanPath", pass(startScan));
ipcMain.handle("ob:cancelScan", pass(cancelScan));
ipcMain.handle("ob:getDrives", pass(getDrives));
ipcMain.handle("ob:getScans", pass(getScans));
ipcMain.handle("ob:getRenderTree", pass(getRenderTree));
ipcMain.handle("ob:getScanProgress", pass(getScanProgress));
ipcMain.handle("ob:getScanPerfTree", pass(getScanPerfTree));
ipcMain.handle("ob:deleteFiles", pass(deleteFiles));
ipcMain.handle("ob:searchScan", pass(searchScan));
ipcMain.handle("ob:getScanErrors", pass(getScanErrors));
ipcMain.handle("ob:publishRecentScans", pass(setRecentScans));
ipcMain.handle("ob:revealInFinder", pass(shell.showItemInFolder.bind(shell)));
ipcMain.handle("ob:openPath", pass(shell.openPath.bind(shell)));
ipcMain.handle(
	"ob:statPath",
	pass(async (path: string): Promise<Ob.PathStat | null> => {
		try {
			const stats = await fs.stat(path);
			return { exists: true, isDirectory: stats.isDirectory() };
		} catch {
			return { exists: false, isDirectory: false };
		}
	}),
);

app.on("ready", () => {
	onDrivesChange((drives) => broadcast("ob:drives", drives));
	onScansChange((scans) => broadcast("ob:scans", scans));
});
