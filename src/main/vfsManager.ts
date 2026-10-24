import { app } from "electron";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Scan, volumes, type NativeScan } from "./native";
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

// The disks and network shares there are to scan, by mount path.
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
		size: entry.scan?.size() ?? undefined,
		...(entry.status === "failed" ? { error: entry.errors[0] } : {}),
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
	// A failed entry doesn't block a retry — the folder may be back, or the
	// drive reconnected, since the last attempt.
	const existing = scans.get(path);
	if (existing && existing.status !== "failed") {
		return;
	}

	let scan: NativeScan;
	try {
		scan = Scan.create(path, { perf: PERF });
	} catch (e) {
		// Constructor throws synchronously if stat-ing the root fails
		// (e.g. path doesn't exist). Record a failed entry with the error
		// attached so the renderer can explain it rather than spinning
		// forever or showing an empty inspect view.
		scans.set(path, {
			status: "failed",
			scan: null,
			drive: null,
			errors: [rootError(path, e)],
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
			entry.errors = [rootError(path, err)];
			entry.scan = null;
			entry.status = "failed";
			entry.revision++;
			emitter.emit("scans", getScans());
		},
	);
}

// Throws out the finished scan of `path` and walks it again, for when files
// have changed outside the app. A scan that's still running is already as
// fresh as it gets, and the dev fake disk has nothing on disk to re-read.
export function rescan(path: string) {
	const existing = scans.get(path);
	if (existing?.status === "building" || path.startsWith("fake://")) {
		return;
	}
	existing?.scan?.release();
	scans.delete(path);
	startScan(path);
}

// The native scanner only hands back a formatted message for root-level
// failures, so re-stat the root ourselves to tell "it's gone" apart from
// "we can't read it" — the renderer words those very differently.
function rootError(path: string, err: unknown): Ob.ScanError {
	const message = errorMessage(err);
	try {
		fs.statSync(path);
	} catch (statErr) {
		const code = (statErr as NodeJS.ErrnoException).code ?? null;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return { path, kind: "missing", code, message };
		}
		if (code === "EACCES" || code === "EPERM") {
			return { path, kind: "permission", code, message };
		}
	}
	return { path, kind: "other", code: null, message };
}

// napi-rs rejects with an empty message when a call into V8 fails, leaving
// only a status in `code`. Say something, at least.
function errorMessage(err: unknown): string {
	if (!(err instanceof Error)) {
		return String(err);
	}
	const { code } = err as NodeJS.ErrnoException;
	return err.message || `The scanner failed (${code ?? err.name})`;
}

// If the scan's root path is a drive's mount path, the drive's name and
// total capacity. The renderer uses the capacity for the legend's
// free-space row and to anchor sunburst slice positions; the name becomes
// the user-visible scan label in the title bar. The scanner itself is
// drive-agnostic by design, so this glue lives here.
function scanDrive(scanPath: string): ScanDrive | null {
	const drive = drives.get(scanPath);
	if (!drive) {
		return null;
	}
	return {
		name: drive.description,
		capacity: drive.usage?.total ?? null,
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

// Windows takes either slash. Everywhere else "\" is a character a name can
// have.
const separator = process.platform === "win32" ? /[/\\]/ : /\//;

// The names leading from `root` down to `target`; empty if `target` is
// `root` itself or isn't inside it.
function partsBelow(root: string, target: string): string[] {
	if (!target.startsWith(root)) {
		return [];
	}
	const rest = target.slice(root.length);
	// "/a/bc" isn't inside "/a/b", though anything is inside "/" or "C:\".
	if (!separator.test(rest.charAt(0)) && !separator.test(root.slice(-1))) {
		return [];
	}
	return rest.split(separator).filter(Boolean);
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
	const next = new Map<string, Ob.PhysicalDrive>();
	const usagePaths = new Map<string, string>();
	for (const { path, usagePath, name, ...facts } of timed("volumes", volumes)) {
		next.set(path, { mountPath: path, description: name, ...facts });
		if (usagePath) {
			usagePaths.set(path, usagePath);
		}
	}

	// A share whose server has dropped off the network can take a minute to
	// answer statfs. Rather than hold up the whole list for it, keep what it
	// said last time.
	await Promise.all(
		Array.from(next.values(), async (drive) => {
			const usage = await Promise.race([
				readVolumeUsage(usagePaths.get(drive.mountPath) ?? drive.mountPath),
				sleep(1000).then(() => drives.get(drive.mountPath)?.usage),
			]);
			if (usage) {
				drive.usage = usage;
			}
		}),
	);

	if (!sameDrives(drives, next) || usageMoved(drives, next)) {
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

// What the OS reports for the volume holding `path` (any path on it, not
// just its mount point), so disks and folders can show how full their
// volume is without scanning it. `used` is whole-volume: on APFS, `/` is a
// sealed system snapshot that shares its container with the Data volume,
// and `blocks - bfree` covers the whole container (what Finder calls used),
// where df's per-volume figure for `/` doesn't.
//
// On a network share, statfs asks the server, and one that has gone away
// leaves the call hanging, holding one of the few libuv threadpool threads
// that scans and every other fs call wait on. So there's only ever one read
// of a path out at a time, which everyone asking shares.
const usageReads = new Map<string, Promise<Ob.DriveUsage | null>>();

export function readVolumeUsage(path: string): Promise<Ob.DriveUsage | null> {
	let read = usageReads.get(path);
	if (!read) {
		read = fs.promises
			.statfs(path)
			.then(
				(stats) => ({
					total: stats.blocks * stats.bsize,
					used: (stats.blocks - stats.bfree) * stats.bsize,
					available: stats.bavail * stats.bsize,
				}),
				() => null,
			)
			.finally(() => usageReads.delete(path));
		usageReads.set(path, read);
	}
	return read;
}

// Free space drifts on every poll, so only re-broadcast once a drive's usage
// has moved by a visible amount (0.1% of its capacity, finer than the size
// labels or meter can show) since the last broadcast.
function usageMoved(
	prev: Map<string, Ob.PhysicalDrive>,
	next: Map<string, Ob.PhysicalDrive>,
): boolean {
	for (const [key, drive] of next) {
		const before = prev.get(key)?.usage ?? null;
		const after = drive.usage ?? null;
		if (!before || !after) {
			if (before !== after) {
				return true;
			}
			continue;
		}
		if (Math.abs(before.used - after.used) > after.total / 1000) {
			return true;
		}
	}
	return false;
}

// Whether `next` lists the same drives as `prev`, the same in everything but
// how full they are. A drive letter on Windows can go to a different disk
// between polls.
function sameDrives(
	prev: Map<string, Ob.PhysicalDrive>,
	next: Map<string, Ob.PhysicalDrive>,
): boolean {
	if (prev.size !== next.size) {
		return false;
	}
	for (const [key, drive] of next) {
		const before = prev.get(key);
		if (!before || driveFacts(before) !== driveFacts(drive)) {
			return false;
		}
	}
	return true;
}

// Both sides build drives the same way, so their keys come out in the same
// order.
const driveFacts = ({ usage: _usage, ...facts }: Ob.PhysicalDrive) =>
	JSON.stringify(facts);
