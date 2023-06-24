import { dialog, ipcMain, screen } from "electron";

import { createVfs, dispatch, store } from "../store/main";
import { getCurrentView } from "./viewManager";

ipcMain.handle("mckayla.observatory.SELECT_DIRECTORY", selectDirectory);
ipcMain.handle("mckayla.observatory.SIZE_TO_DISPLAY", sizeToDisplay);
ipcMain.handle("mckayla.observatory.SIZE_TO_MENU", sizeToMenu);

export async function selectDirectory() {
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory"],
	});

	if (!result.canceled) {
		result.filePaths.forEach((selectedPath) => dispatch(createVfs(selectedPath)));
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
	const state = store.getState();

	let menuItems = state.vfs.size;
	state.drives.forEach((drive) => !state.vfs.has(drive.mountPath) && menuItems++);

	view.setSize(bounds.width, Math.max(220, 150 + 72 * menuItems), true);
}
