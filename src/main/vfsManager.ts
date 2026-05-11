import * as drivelist from "drivelist";
import { app } from "electron";
import { EventEmitter } from "node:events";
import { timed, timedAsync } from "./perf";
import { searchVfs, type SearchResults } from "./search";
import { type PerfNodeInternal, VirtualFileSystem } from "./vfs";

type ScanEntry = {
	status: Ob.ScanStatus;
	vfs: VirtualFileSystem;
	revision: number;
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
		revision: entry.revision,
	}));
}

export function getRenderTree(
	path: string,
	cursor: string[],
): Ob.RenderTree | null {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete") {
		return null;
	}
	return timed(`getRenderTree(${cursor.length} deep)`, () =>
		entry.vfs.getRenderTree(cursor),
	);
}

export function getScanErrors(path: string): Ob.ScanError[] {
	const entry = scans.get(path);
	if (!entry) {
		return [];
	}
	return entry.vfs.errors;
}

export function searchScan(path: string, query: string): SearchResults | null {
	const entry = scans.get(path);
	if (!entry || entry.status !== "complete" || !entry.vfs.root) {
		return null;
	}
	return timed(`searchScan("${query}")`, () =>
		searchVfs(entry.vfs.root!, path, query),
	);
}

export function getScanProgress(path: string): Ob.ScanProgress | null {
	const entry = scans.get(path);
	if (!entry) {
		return null;
	}
	const perfRoot = entry.vfs.perfRoot;
	return {
		path,
		status: entry.status,
		counts: { ...entry.vfs.counts },
		currentPath: entry.vfs.currentPath,
		perfTree: perfRoot ? serializePerfTree(perfRoot) : undefined,
	};
}

export function getScanPerfTree(path: string): Ob.PerfNode | null {
	const entry = scans.get(path);
	if (!entry || !entry.vfs.perfRoot) {
		return null;
	}
	return serializePerfTree(entry.vfs.perfRoot);
}

// Tree-shaping knobs for the IPC payload. Ten levels deep covers the long
// tail without ballooning the JSON; 5ms drops the trivial leaves so the
// flame graph isn't one giant column of slivers.
const PERF_DEPTH_CAP = 10;
const PERF_THRESHOLD_MS = 5;

function serializePerfTree(root: PerfNodeInternal): Ob.PerfNode {
	const snapshot = performance.now();
	const visit = (node: PerfNodeInternal, depth: number): Ob.PerfNode => {
		const elapsedMs = node.inProgress ? snapshot - node.startMs : node.totalMs;
		const childrenOut: Ob.PerfNode[] = [];
		if (depth < PERF_DEPTH_CAP) {
			for (const child of node.children) {
				const childElapsed = child.inProgress
					? snapshot - child.startMs
					: child.totalMs;
				if (childElapsed > PERF_THRESHOLD_MS) {
					childrenOut.push(visit(child, depth + 1));
				}
			}
		}
		return {
			name: node.name,
			path: node.path,
			totalMs: node.totalMs,
			elapsedMs,
			selfMs: node.selfMs,
			readdirMs: node.readdirMs,
			entryCount: node.entryCount,
			depth: node.depth,
			inProgress: node.inProgress,
			children: childrenOut,
		};
	};
	return visit(root, 0);
}

export function startScan(path: string) {
	if (scans.has(path)) {
		return;
	}

	const vfs = new VirtualFileSystem(path);
	scans.set(path, { status: "building", vfs, revision: 0 });
	emitter.emit("scans", getScans());

	vfs.onComplete(() => {
		const entry = scans.get(path);
		// `entry` may be missing if cancelScan ran while the scan was finishing
		// up; the manager already broadcast the deletion, nothing to do here.
		if (!entry || entry.vfs !== vfs) {
			return;
		}
		entry.status = "complete";
		entry.revision++;
		emitter.emit("scans", getScans());
	});
}

// Drop a path from the appropriate scan's VFS in place, propagating the
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

	const walk = walkToParent(entry.vfs.root!, parts);
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
		if (!entry.vfs.root) {
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
