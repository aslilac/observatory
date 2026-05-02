import { app, dialog, ipcMain, screen, webContents } from "electron";

import {
	getDrives,
	getRenderTree,
	getScans,
	onDrivesChange,
	onScansChange,
	startScan,
} from "./vfsManager";
import { getCurrentView } from "./viewManager";

ipcMain.handle("ob:selectDirectory", selectDirectory);
ipcMain.handle("ob:scanPath", (_event, path: string) => startScan(path));
ipcMain.handle("ob:getDrives", () => getDrives());
ipcMain.handle("ob:getScans", () => getScans());
ipcMain.handle("ob:getRenderTree", (_event, path: string, cursor: string[]) =>
	getRenderTree(path, cursor),
);
ipcMain.handle("ob:sizeToDisplay", sizeToDisplay);
ipcMain.handle("ob:sizeToMenu", sizeToMenu);

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

	if (!result.canceled) {
		result.filePaths.forEach((selectedPath) => startScan(selectedPath));
	}
}

export function sizeToDisplay() {
	const view = getCurrentView();

	view.setMinimumSize(800, 600);

	const bounds = view.getBounds();
	const workArea = screen.getPrimaryDisplay().workArea;

	view.setSize(
		bounds.width,
		Math.max(bounds.height, 600, workArea.height - (bounds.y - workArea.y) * 2),
		true,
	);
}

export function sizeToMenu() {
	const view = getCurrentView();

	view.setMinimumSize(800, 220);

	const bounds = view.getBounds();
	const drives = getDrives();
	const scans = getScans();

	const scannedPaths = new Set(scans.map((s) => s.path));
	let menuItems = scans.length;
	drives.forEach((drive) => !scannedPaths.has(drive.mountPath) && menuItems++);

	view.setSize(bounds.width, Math.max(220, 150 + 72 * menuItems), true);
}
