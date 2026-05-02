import { app, dialog, ipcMain, webContents } from "electron";

import { deleteFiles } from "./cleanup";
import {
	getDrives,
	getRenderTree,
	getScans,
	getScanProgress,
	onDrivesChange,
	onScansChange,
	startScan,
} from "./vfsManager";

ipcMain.handle("ob:selectDirectory", selectDirectory);
ipcMain.handle("ob:scanPath", (_event, path: string) => startScan(path));
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

function broadcast(channel: string, payload: unknown) {
	webContents.getAllWebContents().forEach((view) => {
		if (!view.isDestroyed()) view.send(channel, payload);
	});
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

	result.filePaths.forEach((selectedPath) => startScan(selectedPath));

	// Drop the renderer onto the first picked path so it sees the scan
	// progress (and eventually the result) without having to navigate by
	// hand. Multi-pick rolls up to the first one.
	const first = result.filePaths[0];
	if (first) setInspecting(first);
}
