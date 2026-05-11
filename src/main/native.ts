// Loader and TypeScript types for the napi-rs scanner. The .node lives at
// `rust-backend/observatory_scan.node`; `yarn build.native` builds and
// places it. Resolved relative to the Electron app path so dev (where
// app.getAppPath() is the project root) and packaged builds
// (asar.unpack: "**/*.node" puts it at app.asar.unpacked/rust-backend/
// and Electron's asar layer transparently rewrites the require path)
// both find it.
//
// The JS-side `Scan` is a thin wrapper around the raw napi class: the
// underlying `start()` returns the ScanResult as a JSON string built on
// the libuv worker thread, and we JSON.parse it on the JS thread before
// handing the object to vfsManager. That move is significantly faster
// than building V8 objects through N-API set_named_property() one
// property at a time (V8's JSON.parse is optimized C++; per-property
// napi calls round-trip through the binding boundary).

import { app } from "electron";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const nativePath = path.resolve(
	app.getAppPath(),
	"rust-backend/observatory_scan.node",
);

type RawNativeBinding = {
	Scan: RawNativeScanConstructor;
};

type RawNativeScanConstructor = new (
	path: string,
	options: { perf?: boolean },
) => RawNativeScan;

interface RawNativeScan {
	start(): Promise<string>;
	progress(): NativeScanProgress;
	abort(): void;
}

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

let raw: RawNativeBinding;
try {
	raw = require(nativePath) as RawNativeBinding;
} catch (e) {
	const reason = e instanceof Error ? e.message : String(e);
	throw new Error(
		`failed to load native scanner at ${nativePath}: ${reason}\n` +
			"run `yarn build.native` to build it",
	);
}

export class Scan {
	#inner: RawNativeScan;

	constructor(path: string, options: { perf?: boolean }) {
		this.#inner = new raw.Scan(path, options);
	}

	async start(): Promise<NativeScanResult> {
		const json = await this.#inner.start();
		return JSON.parse(json) as NativeScanResult;
	}

	progress(): NativeScanProgress {
		return this.#inner.progress();
	}

	abort(): void {
		this.#inner.abort();
	}
}

export type NativeScan = Scan;
