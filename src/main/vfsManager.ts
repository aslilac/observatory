import * as drivelist from "drivelist";
import { app } from "electron";

import {
	dispatch,
	premountVfs,
	propagateDriveList,
	render,
	store,
	subscribe,
} from "../store/main";
import { VirtualFileSystem } from "./vfs";
import { areMapsSimilar } from "./util";

export const scans = new Map<string, VirtualFileSystem>();

function trimProperty(property: string, from: object) {
	return Object.fromEntries(Object.entries(from).filter(([key]) => key !== property));
}

subscribe(() => {
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

async function scanForDrives() {
	// console.log("updating drive list");

	// Look up drives and propagate them in Redux
	const driveList = await drivelist.list();
	const drives = new Map<string, Ob.PhysicalDrive>();

	driveList.forEach((device) =>
		device.mountpoints.forEach((mount) => {
			// Ignore system volumes on macOS
			if (
				process.platform === "darwin" &&
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
});
