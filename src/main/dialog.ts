import { dialog } from "electron";

import { setInspecting } from "./broadcast";
import { startScan } from "./vfsManager";

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
