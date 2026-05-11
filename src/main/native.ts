// Loader and TypeScript types for the napi-rs scanner. The .node lives at
// `rust-backend/observatory_scan.node`; `yarn build:native` builds and
// places it. Resolved relative to the Electron app path so dev (where
// app.getAppPath() is the project root) and the unpackaged
// `electron-vite preview` flow both find it. Packaging the .node into a
// distributed app is a follow-up — needs forge to copy it out of asar.

import { app } from "electron";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const nativePath = path.resolve(
	app.getAppPath(),
	"rust-backend/observatory_scan.node",
);

type NativeBinding = {
	Scan: NativeScanConstructor;
};

type NativeScanConstructor = new (
	path: string,
	options: { perf?: boolean },
) => NativeScan;

export type NativeScanCounts = {
	files: number;
	directories: number;
	symlinks: number;
	devices: number;
	misc: number;
};

export type NativeScanProgress = {
	counts: NativeScanCounts;
	currentPath: string | null;
	aborted: boolean;
	errorCount: number;
	// Snapshot of the live flame-graph tree when the scan was started
	// with `perf: true`; null otherwise. In-progress directories have
	// `inProgress: true` and `totalMs` computed from wall time since entry.
	perfTree: Ob.PerfNode | null;
};

export type NativeScanResult = {
	root: Ob.VfsDirectory;
	counts: NativeScanCounts;
	errors: Ob.ScanError[];
	perf: Ob.PerfNode | null;
};

export interface NativeScan {
	start(): Promise<NativeScanResult>;
	progress(): NativeScanProgress;
	abort(): void;
}

let native: NativeBinding;
try {
	native = require(nativePath) as NativeBinding;
} catch (e) {
	const reason = e instanceof Error ? e.message : String(e);
	throw new Error(
		`failed to load native scanner at ${nativePath}: ${reason}\n` +
			"run `yarn build.native` to build it",
	);
}
export const Scan = native.Scan;
