import { app, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import * as fs from "node:fs/promises";
import { broadcast } from "./broadcast";
import { deleteFiles } from "./cleanup";
import { buildFakeDisk } from "./fixtures";
import { selectDirectory } from "./dialog";
import { setRecentScans } from "./menu";
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
	readVolumeUsage,
	rescan,
	searchScan,
	startFakeScan,
	startScan,
} from "./vfsManager";

// Drop the `event` arg most handlers don't care about — saves repeating the
// `(_event, ...args) => fn(...args)` boilerplate for every channel.
function pass<A extends unknown[], R>(fn: (...args: A) => R) {
	return (_event: IpcMainInvokeEvent, ...args: A) => fn(...args);
}

ipcMain.handle("Ob.selectDirectory", pass(selectDirectory));
ipcMain.handle("Ob.scanPath", pass(startScan));
ipcMain.handle("Ob.cancelScan", pass(cancelScan));
ipcMain.handle("Ob.rescanPath", pass(rescan));
ipcMain.handle("Ob.getDrives", pass(getDrives));
ipcMain.handle("Ob.getScans", pass(getScans));
ipcMain.handle("Ob.getRenderTree", pass(getRenderTree));
ipcMain.handle("Ob.getScanProgress", pass(getScanProgress));
ipcMain.handle("Ob.getScanPerfTree", pass(getScanPerfTree));
ipcMain.handle("Ob.deleteFiles", pass(deleteFiles));
ipcMain.handle("Ob.searchScan", pass(searchScan));
ipcMain.handle("Ob.getScanErrors", pass(getScanErrors));
ipcMain.handle("Ob.publishRecentScans", pass(setRecentScans));
ipcMain.handle("Ob.revealInFinder", pass(shell.showItemInFolder.bind(shell)));
ipcMain.handle("Ob.openPath", pass(shell.openPath.bind(shell)));
ipcMain.handle("Ob.openFullDiskAccessSettings", () =>
	shell.openExternal(
		"x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
	),
);
ipcMain.handle(
	"Ob.statPath",
	pass(async (path: string): Promise<Ob.PathStat | null> => {
		try {
			const stats = await fs.stat(path);
			const volume = await readVolumeUsage(path);
			return {
				exists: true,
				isDirectory: stats.isDirectory(),
				...(volume ? { volume } : {}),
			};
		} catch {
			return { exists: false, isDirectory: false };
		}
	}),
);

// Dev-only IPC for the "Load fake disk" button on Welcome. Registered only
// in unpackaged builds so production simply doesn't have a handler — if the
// renderer button somehow leaks past its own dev gate, the invoke rejects.
if (!app.isPackaged) {
	ipcMain.handle("Ob.devLoadFakeDisk", () =>
		startFakeScan("demo-disk", buildFakeDisk()),
	);
}

app.on("ready", () => {
	onDrivesChange((drives) => broadcast("Ob.drives", drives));
	onScansChange((scans) => broadcast("Ob.scans", scans));
});
