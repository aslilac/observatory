import * as drivelist from "drivelist";
import { app } from "electron";
import { EventEmitter } from "node:events";
import { Scan, type NativeScan } from "./native";
import { PERF, timed, timedAsync } from "./perf";
import { assembleRenderTree, type ScanDrive } from "./renderTree";

// What we hold per active scan. `scan` is the native handle: it runs the
// walk, then keeps the finished tree, which the queries below go through.
// It's null only for a scan that failed before it got going.
type ScanEntry = {
	status: Ob.ScanStatus;
	scan: NativeScan | null;
	// Set on completion if the scan covered a whole disk.
	drive: ScanDrive | null;
	errors: Ob.ScanError[];
	perf: Ob.PerfNode | null;
	revision: number;
};

// Internal drive record. We expose only `{ mountPath, description }` over
// IPC (the public `Ob.PhysicalDrive` shape), but the manager itself needs
// the raw device size + mount label to describe a scan of a whole disk
// once it completes — that's where `capacity` (for the legend's free
// space row, sunburst position math, etc.) and the friendly drive name
// come from. The native scanner has no concept of drives.
type DriveInfo = {
	mountPath: string;
	label: string | null;
	size: number | null;
	deviceDescription: string;
};

const drives = new Map<string, DriveInfo>();
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
	return Array.from(drives.values()).map((d) => ({
		mountPath: d.mountPath,
		description: d.label || `${d.mountPath} (${d.deviceDescription})`,
	}));
}

export function getScans(): Ob.ScanInfo[] {
	return Array.from(scans.entries()).map(([path, entry]) => ({
		path,
		status: entry.status,
		size: entry.scan?.size() ?? undefined,
		revision: entry.revision,
	}));
}

export function getRenderTree(
	path: string,
	cursor: string[],
): Ob.RenderTree | null {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete" || !entry.scan) {
		return null;
	}
	const { scan, drive } = entry;
	return timed(`getRenderTree(${cursor.length} deep)`, () => {
		const slice = scan.renderTree(cursor);
		return slice && assembleRenderTree(slice, cursor, drive);
	});
}

export function getScanErrors(path: string): Ob.ScanError[] {
	const entry = scans.get(path);
	if (!entry) {
		return [];
	}
	return entry.errors;
}

export async function searchScan(
	path: string,
	query: string,
): Promise<Ob.SearchResults | null> {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete" || !entry.scan) {
		return null;
	}
	const scan = entry.scan;
	return timedAsync(`searchScan("${query}")`, () => scan.search(path, query));
}

const EMPTY_COUNTS = {
	files: 0,
	directories: 0,
	symlinks: 0,
	devices: 0,
	misc: 0,
};

export function getScanProgress(path: string): Ob.ScanProgress | null {
	const entry = scans.get(path);
	if (!entry) {
		return null;
	}
	// During the walk: read live state straight off the native handle. After
	// completion: synthesize a snapshot from the cached result so callers
	// still get a sensible reply (counts derivable from the tree would be
	// expensive; just return zeros since the renderer ignores progress
	// once status flips to "complete").
	if (entry.status === "building" && entry.scan) {
		const p = entry.scan.progress();
		return {
			path,
			status: entry.status,
			counts: p.counts,
			currentPath: p.currentPath,
			...(p.perfTree ? { perfTree: p.perfTree } : {}),
		};
	}
	return {
		path,
		status: entry.status,
		counts: EMPTY_COUNTS,
		currentPath: null,
		...(entry.perf ? { perfTree: entry.perf } : {}),
	};
}

export function getScanPerfTree(path: string): Ob.PerfNode | null {
	return scans.get(path)?.perf ?? null;
}

export function startScan(path: string) {
	if (scans.has(path)) {
		return;
	}

	let scan: NativeScan;
	try {
		scan = Scan.create(path, { perf: PERF });
	} catch (e) {
		// Constructor throws synchronously if stat-ing the root fails
		// (e.g. path doesn't exist). Record an entry that immediately
		// shows as complete with the error attached so the renderer can
		// surface it rather than spinning forever on a missing path.
		const message = e instanceof Error ? e.message : String(e);
		scans.set(path, {
			status: "complete",
			scan: null,
			drive: null,
			errors: [{ path, kind: "other", code: null, message }],
			perf: null,
			revision: 1,
		});
		emitter.emit("scans", getScans());
		return;
	}

	const entry: ScanEntry = {
		status: "building",
		scan,
		drive: null,
		errors: [],
		perf: null,
		revision: 0,
	};
	scans.set(path, entry);
	emitter.emit("scans", getScans());

	scan.start().then(
		(result) => {
			const current = scans.get(path);
			// cancelScan may have removed the entry while we were running;
			// the deletion broadcast already fired, nothing else to do.
			if (!current || current !== entry) {
				return;
			}
			entry.drive = scanDrive(path);
			entry.errors = result.errors;
			entry.perf = result.perf;
			entry.status = "complete";
			entry.revision++;
			emitter.emit("scans", getScans());
		},
		(err: unknown) => {
			const current = scans.get(path);
			if (!current || current !== entry) {
				return;
			}
			entry.errors = [
				{
					path,
					kind: "other",
					code: null,
					message: err instanceof Error ? err.message : String(err),
				},
			];
			entry.scan = null;
			entry.status = "complete";
			entry.revision++;
			emitter.emit("scans", getScans());
		},
	);
}

// If the scan's root path matches a drivelist mountpoint, the drive's mount
// label and total capacity. The renderer uses the capacity for the legend's
// free-space row and to anchor sunburst slice positions; the name becomes
// the user-visible scan label in the title bar. The native scanner is
// drive-agnostic by design, so this glue lives here.
function scanDrive(scanPath: string): ScanDrive | null {
	const drive = drives.get(scanPath);
	if (!drive) {
		return null;
	}
	return {
		name: drive.label || `${drive.deviceDescription} (${drive.mountPath})`,
		capacity: drive.size,
	};
}

// Dev-only entry point: register a synthetic completed scan from a pre-built
// VFS root. Used by the "Load fake disk" button so the inspect view can be
// exercised without waiting on a real multi-minute disk scan.
export function startFakeScan(name: string, root: Ob.VfsDirectory): string {
	const path = `fake://${name}`;
	if (scans.has(path)) {
		return path;
	}
	scans.set(path, {
		status: "complete",
		scan: Scan.fromTree(root),
		drive: { name: root.name, capacity: root.capacity ?? null },
		errors: [],
		perf: null,
		revision: 1,
	});
	emitter.emit("scans", getScans());
	return path;
}

// Drop a path from every scan's tree that has it, propagating the removed
// size up through every ancestor. Used after the cleanup queue trashes
// things so subsequent browsing doesn't keep showing them. Scans can nest
// (someone scanned both /Users/alice and /Users/alice/Movies), and each
// has its own copy of the tree.
export function removePath(target: string) {
	let changed = false;
	for (const [root, entry] of scans) {
		if (entry.status !== "complete" || !entry.scan) {
			continue;
		}
		const parts = partsBelow(root, target);
		if (parts.length > 0 && entry.scan.remove(parts)) {
			entry.revision++;
			changed = true;
		}
	}
	if (changed) {
		emitter.emit("scans", getScans());
	}
}

// The names leading from `root` down to `target`; empty if `target` is
// `root` itself or isn't inside it.
function partsBelow(root: string, target: string): string[] {
	if (!target.startsWith(root)) {
		return [];
	}
	const rest = target.slice(root.length);
	// "/a/bc" isn't inside "/a/b", though anything is inside "/" or "C:\".
	if (!/^[/\\]/.test(rest) && !/[/\\]$/.test(root)) {
		return [];
	}
	return rest.split(/[/\\]+/).filter(Boolean);
}

export function cancelScan(path: string) {
	const entry = scans.get(path);
	if (!entry) {
		return;
	}
	entry.scan?.abort();
	entry.scan?.release();
	scans.delete(path);
	emitter.emit("scans", getScans());
}

async function pollDrives() {
	const driveList = await timedAsync("drivelist.list", () => drivelist.list());
	const next = new Map<string, DriveInfo>();

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
					label: mount.label || null,
					size: device.size ?? null,
					deviceDescription: device.description,
				});
			}
		}
	}

	if (!areMapsSimilar(drives, next)) {
		drives.clear();
		for (const [key, value] of next) {
			drives.set(key, value);
		}
		emitter.emit("drives", getDrives());
	}
}

app.on("ready", () => {
	void pollDrives();
	setInterval(pollDrives, 5000);
});

function areMapsSimilar<K = unknown, V = unknown>(a: Map<K, V>, b: Map<K, V>) {
	if (a.size !== b.size) {
		return false;
	}

	const keysA = Array.from(a.keys());
	const keysB = Array.from(b.keys());

	return keysA.every((key) => keysB.includes(key));
}
