import { app, dialog, ipcMain, shell, webContents } from "electron";
import * as fs from "node:fs/promises";

import { deleteFiles } from "./cleanup";
import { setRecentScans } from "./system/menu";
import {
	cancelScan,
	getDrives,
	getRenderTree,
	getScanErrors,
	getScans,
	getScanProgress,
	onDrivesChange,
	onScansChange,
	searchScan,
	startScan,
} from "./vfsManager";

ipcMain.handle("ob:selectDirectory", selectDirectory);
ipcMain.handle("ob:scanPath", (_event, path: string) => startScan(path));
ipcMain.handle("ob:cancelScan", (_event, path: string) => cancelScan(path));
ipcMain.handle("ob:getDrives", () => getDrives());
ipcMain.handle("ob:getScans", () => getScans());
ipcMain.handle("ob:getRenderTree", (_event, path: string, cursor: string[]) =>
	getRenderTree(path, cursor),
);
ipcMain.handle("ob:getScanProgress", (_event, path: string) =>
	getScanProgress(path),
);
ipcMain.handle("ob:deleteFiles", (_event, paths: string[]) =>
	deleteFiles(paths),
);
ipcMain.handle("ob:searchScan", (_event, path: string, query: string) =>
	searchScan(path, query),
);
ipcMain.handle("ob:getScanErrors", (_event, path: string) =>
	getScanErrors(path),
);
ipcMain.handle(
	"ob:statPath",
	async (_event, path: string): Promise<Ob.PathStat | null> => {
		try {
			const stats = await fs.stat(path);
			return { exists: true, isDirectory: stats.isDirectory() };
		} catch {
			return { exists: false, isDirectory: false };
		}
	},
);
ipcMain.handle(
	"ob:publishRecentScans",
	(_event, recents: Array<{ path: string; scannedAt: number }>) =>
		setRecentScans(recents),
);
ipcMain.handle("ob:revealInFinder", (_event, path: string) => {
	shell.showItemInFolder(path);
});
ipcMain.handle("ob:openPath", (_event, path: string) =>
	shell.openPath(path),
);

function broadcast(channel: string, payload: unknown) {
	for (const view of webContents.getAllWebContents()) {
		if (!view.isDestroyed()) view.send(channel, payload);
	}
}

app.on("ready", () => {
	onDrivesChange((drives) => broadcast("ob:drives", drives));
	onScansChange((scans) => broadcast("ob:scans", scans));
});

export function setInspecting(path: string | null) {
	broadcast("ob:setInspecting", path);
}

export async function selectDirectory() {
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory"],
	});

	if (result.canceled) return;

	for (const selectedPath of result.filePaths) startScan(selectedPath);

	// Drop the renderer onto the first picked path so it sees the scan
	// progress (and eventually the result) without having to navigate by
	// hand. Multi-pick rolls up to the first one.
	const first = result.filePaths[0];
	if (first) setInspecting(first);
}
