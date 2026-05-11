// Standalone Node benchmark that mirrors the algorithm in src/main/vfs.ts
// without its drivelist/perf dependencies, so we can compare wall time
// against the Rust scanner on the same path.
//
// Usage: node bench-js.mjs <path>

import * as fs from "node:fs/promises";
import * as path from "node:path";

const counts = {
	files: 0,
	directories: 0,
	symlinks: 0,
	devices: 0,
	misc: 0,
	errors: 0,
};

async function scan(location) {
	const state = {
		type: "directory",
		name: path.basename(location) || location,
		size: 0,
		mtime: 0,
		files: [],
	};
	const ownStats = await fs.lstat(location).catch(() => {
		counts.errors++;
		return undefined;
	});
	state.mtime = ownStats?.mtimeMs ?? 0;
	const files = await fs.readdir(location).catch(() => {
		counts.errors++;
		return undefined;
	});
	if (!files) return state;
	await Promise.all(
		files.map(async (name) => {
			const entity = path.join(location, name);
			const stats = await fs.lstat(entity).catch(() => {
				counts.errors++;
				return undefined;
			});
			if (!stats) return;
			if (stats.isFile()) {
				counts.files++;
				state.files.push({
					type: "file",
					name,
					size: stats.size,
					mtime: stats.mtimeMs,
				});
				state.size += stats.size;
				if (stats.mtimeMs > state.mtime) state.mtime = stats.mtimeMs;
				return;
			}
			if (stats.isDirectory()) {
				counts.directories++;
				const directory = await scan(entity);
				state.files.push({ ...directory, name });
				state.size += directory.size;
				if (directory.mtime > state.mtime) state.mtime = directory.mtime;
				return;
			}
			if (stats.isSymbolicLink()) {
				counts.symlinks++;
				return;
			}
			if (stats.isCharacterDevice() || stats.isBlockDevice()) {
				counts.devices++;
				return;
			}
			counts.misc++;
		}),
	);
	state.files.sort((a, b) => b.size - a.size);
	return state;
}

const target = process.argv[2];
if (!target) {
	console.error("usage: node bench-js.mjs <path>");
	process.exit(2);
}

const start = performance.now();
await scan(target);
const ms = performance.now() - start;
const total =
	counts.files +
	counts.directories +
	counts.symlinks +
	counts.devices +
	counts.misc;
console.error(
	`[perf:scan] ${target} ${ms.toFixed(0)}ms · ${total} entries (${counts.files} files, ${counts.directories} dirs, ${counts.symlinks} symlinks, ${counts.misc} other; ${counts.errors} errors)`,
);
