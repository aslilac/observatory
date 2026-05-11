import { dialog } from "electron";

// Show the system folder picker. Returns the chosen path (or undefined if
// the user canceled) so the caller can decide what to do with it — start
// a scan, navigate the renderer, etc. We don't kick the scan off here so
// that menu items and renderer-driven flows stay symmetric.
export async function selectDirectory(): Promise<string | undefined> {
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory"],
	});
	if (result.canceled) return undefined;
	return result.filePaths[0];
}
