import * as drivelist from "drivelist";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { PERF, perfLog } from "./perf";

// Per-directory work below this is too noisy to log individually.
const DIR_LOG_THRESHOLD_MS = 50;

export class VirtualFileSystem {
	location: string;
	root: Ob.VfsDirectory | null = null;
	scan: Promise<void> | null = null;

	counts: {
		files: number;
		directories: number;
		symlinks: number;
		devices: number;
		misc: number;
	};

	// Most recent directory entered by `_scan`. The recursion is parallel via
	// Promise.all, so this is an arbitrary "we're somewhere here" indicator
	// rather than a precise breadth-first tip — good enough for a status line.
	currentPath: string | null = null;

	errors: Ob.ScanError[] = [];

	// Set by `abort()` from the manager when the user cancels. Each `_scan`
	// recursion bails early once this flips so the scan winds down without
	// piling on new fs work; in-flight syscalls finish but their results
	// are dropped.
	private aborted = false;

	// Device id of the scan root. Subdirectories on other devices are
	// crossed-mount-point boundaries (procfs, sysfs, tmpfs, /Volumes,
	// network shares, FUSE mounts, …) — none of which represent real
	// disk usage on the device the user actually wants to inspect, so
	// we refuse to descend past them.
	private rootDev: number | null = null;

	private onCompleteCallbacks: Array<() => void> = [];

	constructor(location: string) {
		this.location = path.normalize(location);

		this.counts = {
			files: 0,
			directories: 0,
			symlinks: 0,
			devices: 0,
			misc: 0,
		};

		this.startScan();
	}

	onComplete(cb: () => void) {
		if (this.root) {
			cb();
			return;
		}
		this.onCompleteCallbacks.push(cb);
	}

	abort() {
		this.aborted = true;
	}

	get isAborted(): boolean {
		return this.aborted;
	}

	startScan() {
		if (!this.scan) {
			this.scan = this.performScan();
		}
		return this.scan;
	}

	private async performScan() {
		const location = this.location;

		// TODO: We should probably check that it's a directory, and handle errors
		// if it doesn't exist
		const rootStats = await fs.stat(location);
		this.rootDev = rootStats.dev;

		const scanStart = performance.now();

		const vfs = await this._scan(location);
		// path.basename("/") returns "" — fall back to the location itself so
		// the renderer never gets an empty name to display.
		vfs.name = path.basename(location) || location;

		const scanMs = performance.now() - scanStart;
		const c = this.counts;
		const total = c.files + c.directories + c.symlinks + c.devices + c.misc;
		console.log(
			`[perf:scan] ${location} ${scanMs.toFixed(0)}ms · ${total.toLocaleString()} entries (${c.files} files, ${c.directories} dirs, ${c.symlinks} symlinks)`,
		);

		// Set the name and capacity if it's a drive
		const list = await drivelist.list();
		list.some((device) =>
			device.mountpoints.some((mount) => {
				if (mount.path === location) {
					vfs.name = mount.label || `${device.description} (${mount.path})`;
					vfs.capacity = device.size ?? undefined;
				}
			}),
		);

		this.root = vfs;
		const callbacks = this.onCompleteCallbacks;
		this.onCompleteCallbacks = [];
		callbacks.forEach((cb) => cb());
	}

	private async _scan(location: string): Promise<Ob.VfsDirectory> {
		const state: Ob.VfsDirectory = {
			type: "directory",
			name: "MISSING_NO",
			size: 0,
			mtime: 0,
			files: [],
		};
		if (this.aborted) return state;
		this.currentPath = location;

		const ownStats = await fs.lstat(location).catch((error: unknown) => {
			this.recordError(location, error);
			return undefined;
		});
		state.mtime = ownStats?.mtimeMs ?? 0;

		const readdirStart = PERF ? performance.now() : 0;
		const files = await fs.readdir(location).catch((error: unknown) => {
			this.recordError(location, error);
			return undefined;
		});
		if (PERF) {
			const readdirMs = performance.now() - readdirStart;
			if (readdirMs > DIR_LOG_THRESHOLD_MS) {
				perfLog(
					"scan",
					`readdir ${location} ${readdirMs.toFixed(0)}ms (${files?.length ?? 0} entries)`,
				);
			}
		}

		if (!files) return state;

		await Promise.all(
			files.map(async (name) => {
				if (this.aborted) return;
				const entity = path.join(location, name);
				const stats = await fs.lstat(entity).catch((error: unknown) => {
					this.recordError(entity, error);
					return undefined;
				});

				if (!stats) return;
				else if (stats.isFile()) {
					this.counts.files++;
					state.files.push({
						type: "file",
						name,
						size: stats.size,
						mtime: stats.mtimeMs,
					});
					state.size += stats.size;
					if (stats.mtimeMs > state.mtime) state.mtime = stats.mtimeMs;
				} else if (stats.isDirectory()) {
					this.counts.directories++;

					if (shouldSkipDirectory(entity, stats.dev, this.rootDev)) {
						return;
					}

					const directory = await this._scan(entity);
					state.files.push({
						...directory,
						name,
					});
					state.size += directory.size;
					if (directory.mtime > state.mtime) state.mtime = directory.mtime;
				} else if (stats.isSymbolicLink()) {
					this.counts.symlinks++;
				} else if (stats.isCharacterDevice() || stats.isBlockDevice()) {
					this.counts.devices++;
				} else {
					this.counts.misc++;
				}
			}),
		);

		state.files.sort((a, b) => b.size - a.size);
		return state;
	}

	private recordError(targetPath: string, error: unknown) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code: unknown }).code)
				: null;
		const message = error instanceof Error ? error.message : String(error);
		const kind: Ob.ScanError["kind"] =
			code === "EACCES" || code === "EPERM"
				? "permission"
				: code === "ENOENT"
					? "missing"
					: code === "ELOOP"
						? "loop"
						: "other";
		this.errors.push({ path: targetPath, kind, code, message });
	}

	private getDirectory(cursor: string[]) {
		if (!this.root) {
			throw new TypeError(
				`Trying to read directory "./${cursor.join(
					"/",
				)}" from uninitialized root`,
			);
		}

		const scale = this.root.size;
		let position = 0;
		let current = this.root;
		const correct = cursor.every((piece) =>
			current.files.some((file) => {
				if (file.name === piece && file.type === "directory") {
					current = file;
					return true;
				}

				position += file.size / scale;
				return false;
			}),
		);

		return (
			correct && {
				position,
				...current,
			}
		);
	}

	getRenderTree(cursor: string[] = []): Ob.RenderTree | null {
		if (!this.root) return null;

		const directory = this.getDirectory(cursor);
		if (!directory) return null;

		const isLargeEnough = (file: Ob.VfsNode) =>
			file.size > directory.size * 0.003;
		const sanitize =
			(recursive = 0) =>
			(file: Ob.VfsNode): Ob.VfsNode =>
				file.type === "directory"
					? {
							name: file.name,
							type: file.type,
							size: file.size,
							mtime: file.mtime,
							files:
								recursive > 0 && file.type === "directory"
									? file.files
											.filter(isLargeEnough)
											.map(sanitize(recursive - 1))
									: [],
						}
					: {
							name: file.name,
							type: file.type,
							size: file.size,
							mtime: file.mtime,
						};

		const sortAlpha = (files: Ob.VfsNode[]) =>
			files.slice().sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			);

		const root = this.root;

		return {
			name: root.name,
			cursor,
			type: "directory",
			rootCapacity: root.capacity || root.size,
			rootSize: root.size,
			capacity: directory.capacity || directory.size,
			position: directory.position,
			size: directory.size,
			list: {
				files: directory.files.map(sanitize()),
			},
			sunburst: {
				files: directory.files.filter(isLargeEnough).map(sanitize(6)),
			},
			tree: {
				// Only ship immediate children — the FolderTree component
				// lazily fetches deeper levels via getRenderTree(subCursor),
				// so a recursive payload here would balloon to tens of MB on
				// dense scans without buying anything the user can see yet.
				files: sortAlpha(directory.files).map(sanitize()),
			},
		};
	}
}

// macOS Catalina+ has firmlinks that make the read-only system volume and
// the writable data volume appear as one tree at /. The kernel reports
// stat("/") as the data volume's device, which means a naive cross-device
// check ALSO matches /System/Volumes/Data — recursing into it duplicates
// the entire user home tree under that path. The blocklist below covers
// the firmlink shadow paths that don't exist on disk in any meaningful
// sense and should never be descended into regardless of dev id.
const DARWIN_SHADOW_PATHS: ReadonlySet<string> = new Set([
	"/Volumes",
	"/System/Volumes",
	"/private/var/db/dyld",
]);

function shouldSkipDirectory(
	entity: string,
	dev: number,
	rootDev: number | null,
): boolean {
	if (process.platform === "darwin") {
		if (DARWIN_SHADOW_PATHS.has(entity)) return true;
		// Skip /System/Volumes/* explicitly so we never recurse into Update,
		// Preboot, Recovery, VM, Data, etc. — all duplicates of content
		// reachable via the firmlinked root.
		if (entity.startsWith("/System/Volumes/")) return true;
	}

	if (process.platform === "linux" && entity === "/proc") return true;

	// Generic cross-device skip — catches procfs / sysfs / tmpfs / external
	// drives / network shares / FUSE mounts on every platform. Skipped on
	// macOS for non-shadow paths because firmlinks make this check
	// unreliable: stat("/") returns the data volume, so legitimate user
	// content like /Users would be filtered out by it.
	if (process.platform !== "darwin" && rootDev !== null && dev !== rootDev) {
		return true;
	}

	return false;
}
