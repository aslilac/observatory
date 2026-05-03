import * as drivelist from "drivelist";
import { app } from "electron";
import { EventEmitter } from "node:events";

import { timed, timedAsync } from "./perf";
import { searchVfs, type SearchResults } from "./search";
import { areMapsSimilar } from "./util";
import { VirtualFileSystem } from "./vfs";

type ScanEntry = {
	status: Ob.ScanStatus;
	vfs: VirtualFileSystem;
};

const drives = new Map<string, Ob.PhysicalDrive>();
const scans = new Map<string, ScanEntry>();

const emitter = new EventEmitter();

export function onDrivesChange(cb: (drives: Ob.PhysicalDrive[]) => void) {
	emitter.on("drives", cb);
	return () => emitter.off("drives", cb);
}

export function onScansChange(cb: (scans: Ob.ScanInfo[]) => void) {
	emitter.on("scans", cb);
	return () => emitter.off("scans", cb);
}

export function getDrives(): Ob.PhysicalDrive[] {
	return Array.from(drives.values());
}

export function getScans(): Ob.ScanInfo[] {
	return Array.from(scans.entries()).map(([path, entry]) => ({
		path,
		status: entry.status,
		size: entry.vfs.root?.size,
	}));
}

export function getRenderTree(
	path: string,
	cursor: string[],
): Ob.RenderTree | null {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete") return null;
	return timed(`getRenderTree(${cursor.length} deep)`, () =>
		entry.vfs.getRenderTree(cursor),
	);
}

export function getScanErrors(path: string): Ob.ScanError[] {
	const entry = scans.get(path);
	if (!entry) return [];
	return entry.vfs.errors;
}

export function searchScan(path: string, query: string): SearchResults | null {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete" || !entry.vfs.root) return null;
	return timed(`searchScan("${query}")`, () =>
		searchVfs(entry.vfs.root!, path, query),
	);
}

export function getScanProgress(path: string): Ob.ScanProgress | null {
	const entry = scans.get(path);
	if (!entry) return null;
	return {
		path,
		status: entry.status,
		counts: { ...entry.vfs.counts },
		currentPath: entry.vfs.currentPath,
	};
}

export function startScan(path: string) {
	if (scans.has(path)) return;

	const vfs = new VirtualFileSystem(path);
	scans.set(path, { status: "building", vfs });
	emitter.emit("scans", getScans());

	vfs.onComplete(() => {
		const entry = scans.get(path);
		// `entry` may be missing if cancelScan ran while the scan was finishing
		// up; the manager already broadcast the deletion, nothing to do here.
		if (!entry || entry.vfs !== vfs) return;
		entry.status = "complete";
		emitter.emit("scans", getScans());
	});
}

export function cancelScan(path: string) {
	const entry = scans.get(path);
	if (!entry) return;
	entry.vfs.abort();
	scans.delete(path);
	emitter.emit("scans", getScans());
}

async function pollDrives() {
	const driveList = await timedAsync("drivelist.list", () => drivelist.list());
	const next = new Map<string, Ob.PhysicalDrive>();

	for (const device of driveList) {
		for (const mount of device.mountpoints) {
			if (
				process.platform === "darwin" &&
				mount.path.startsWith("/System/Volumes")
			) {
				continue;
			}

			if (!next.has(mount.path)) {
				next.set(mount.path, {
					mountPath: mount.path,
					description: mount.label || `${mount.path} (${device.description})`,
				});
			}
		}
	}

	if (!areMapsSimilar(drives, next)) {
		drives.clear();
		for (const [key, value] of next) drives.set(key, value);
		emitter.emit("drives", getDrives());
	}
}

app.on("ready", () => {
	void pollDrives();
	setInterval(pollDrives, 5000);
});
