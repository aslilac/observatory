import * as drivelist from "drivelist";
import { app } from "electron";
import { EventEmitter } from "node:events";
import { Scan, type NativeScan } from "./native";
import { PERF, timed, timedAsync } from "./perf";
import { buildRenderTree } from "./renderTree";
import { searchVfs, type SearchResults } from "./search";

// What we hold per active scan. `scan` is the native handle while the
// walk is in flight (null afterward — once we have the final tree there's
// nothing to query it for). `root` is populated when the scan resolves
// or, in the case of startFakeScan, set directly without ever creating
// a Scan instance.
type ScanEntry = {
	status: Ob.ScanStatus;
	scan: NativeScan | null;
	root: Ob.VfsDirectory | null;
	errors: Ob.ScanError[];
	perf: Ob.PerfNode | null;
	revision: number;
};

// Internal drive record. We expose only `{ mountPath, description }` over
// IPC (the public `Ob.PhysicalDrive` shape), but the manager itself needs
// the raw device size + mount label to decorate the root VfsDirectory
// after a scan completes — that's where `capacity` (for the legend's free
// space row, sunburst position math, etc.) and the friendly drive name
// come from. drivelist re-querying these inside the scan happens in the
// old JS scanner but the native scanner has no concept of drives.
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
		size: entry.root?.size,
		revision: entry.revision,
	}));
}

export function getRenderTree(
	path: string,
	cursor: string[],
): Ob.RenderTree | null {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete" || !entry.root) {
		return null;
	}
	const root = entry.root;
	return timed(`getRenderTree(${cursor.length} deep)`, () =>
		buildRenderTree(root, cursor),
	);
}

export function getScanErrors(path: string): Ob.ScanError[] {
	const entry = scans.get(path);
	if (!entry) {
		return [];
	}
	return entry.errors;
}

export function searchScan(path: string, query: string): SearchResults | null {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete" || !entry.root) {
		return null;
	}
	const root = entry.root;
	return timed(`searchScan("${query}")`, () => searchVfs(root, path, query));
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
	if (entry.scan) {
		const p = entry.scan.progress();
		return {
			path,
			status: entry.status,
			counts: p.counts,
			currentPath: p.currentPath,
			// Live perf streaming isn't wired through yet — the native
			// binding only emits the perf tree in the final result.
			...(entry.perf ? { perfTree: entry.perf } : {}),
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
		scan = new Scan(path, { perf: PERF });
	} catch (e) {
		// Constructor throws synchronously if stat-ing the root fails
		// (e.g. path doesn't exist). Record an entry that immediately
		// shows as complete with the error attached so the renderer can
		// surface it rather than spinning forever on a missing path.
		const message = e instanceof Error ? e.message : String(e);
		scans.set(path, {
			status: "complete",
			scan: null,
			root: null,
			errors: [
				{ path, kind: "other", code: null, message },
			],
			perf: null,
			revision: 1,
		});
		emitter.emit("scans", getScans());
		return;
	}

	const entry: ScanEntry = {
		status: "building",
		scan,
		root: null,
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
			decorateWithDriveInfo(result.root, path);
			entry.root = result.root;
			entry.errors = result.errors;
			entry.perf = result.perf;
			entry.scan = null;
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

// If the scan's root path matches a drivelist mountpoint, copy the drive's
// total capacity and mount label onto the root VfsDirectory. The renderer
// reads `root.capacity` for the legend's free-space row and to anchor
// sunburst slice positions; `root.name` becomes the user-visible scan
// label in the title bar. The native scanner is drive-agnostic by design,
// so this glue lives here.
function decorateWithDriveInfo(root: Ob.VfsDirectory, scanPath: string): void {
	const drive = drives.get(scanPath);
	if (!drive) {
		return;
	}
	if (drive.size !== null) {
		root.capacity = drive.size;
	}
	root.name = drive.label || `${drive.deviceDescription} (${drive.mountPath})`;
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
		scan: null,
		root,
		errors: [],
		perf: null,
		revision: 1,
	});
	emitter.emit("scans", getScans());
	return path;
}

// Drop a path from the appropriate scan's tree in place, propagating the
// removed size up through every ancestor. Used after the cleanup queue
// trashes things so subsequent browsing doesn't keep showing them.
export function removePath(target: string) {
	const owner = findOwningScan(target);
	if (!owner) {
		return;
	}
	const { root, entry } = owner;

	const relative = target.slice(root.length).replace(/^[/\\]+/, "");
	if (!relative) {
		return;
	} // can't remove the scan root itself
	const parts = relative.split(/[/\\]+/);

	if (!entry.root) {
		return;
	}
	const walk = walkToParent(entry.root, parts);
	if (!walk) {
		return;
	}
	const { current, ancestors } = walk;

	const lastPart = parts[parts.length - 1]!;
	const idx = current.files.findIndex((f) => f.name === lastPart);
	if (idx < 0) {
		return;
	}

	const removedSize = current.files[idx]!.size;
	current.files.splice(idx, 1);
	for (const ancestor of ancestors) {
		ancestor.size -= removedSize;
	}

	entry.revision++;
	emitter.emit("scans", getScans());
}

// Pick the scan whose root is the longest prefix of `target` — handles the
// case where someone scanned both /Users/alice and /Users/alice/Movies and
// we delete something in the latter. Both match; we want the deeper one.
function findOwningScan(
	target: string,
): { root: string; entry: ScanEntry } | undefined {
	let best: { root: string; entry: ScanEntry } | undefined;
	for (const [root, entry] of scans) {
		const inside =
			target === root ||
			target.startsWith(`${root}/`) ||
			target.startsWith(`${root}\\`);
		if (!inside) {
			continue;
		}
		if (!entry.root) {
			continue;
		}
		if (!best || root.length > best.root.length) {
			best = { root, entry };
		}
	}
	return best;
}

// Walk `parts[0..-2]` from `start`, returning the parent directory of the
// final path segment plus every ancestor we passed through (so the caller
// can subtract the removed size from each).
function walkToParent(
	start: Ob.VfsDirectory,
	parts: string[],
): { current: Ob.VfsDirectory; ancestors: Ob.VfsDirectory[] } | undefined {
	let current = start;
	const ancestors: Ob.VfsDirectory[] = [current];
	for (let i = 0; i < parts.length - 1; i++) {
		const child = current.files.find(
			(f) => f.name === parts[i] && f.type === "directory",
		);
		if (!child) {
			return undefined;
		}
		current = child as Ob.VfsDirectory;
		ancestors.push(current);
	}
	return { current, ancestors };
}

export function cancelScan(path: string) {
	const entry = scans.get(path);
	if (!entry) {
		return;
	}
	entry.scan?.abort();
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
