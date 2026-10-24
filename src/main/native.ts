// Loader and TypeScript types for the napi-rs scanner. The .node lives at
// `src/scanner/observatory_scan.node`; `yarn build.native` builds and
// places it. Resolved relative to the Electron app path so dev (where
// app.getAppPath() is the project root) and packaged builds
// (asar.unpack: "**/*.node" puts it at app.asar.unpacked/src/scanner/
// and Electron's asar layer transparently rewrites the require path)
// both find it.
//
// A `Scan` walks a directory and then keeps the finished tree on the Rust
// side, where the main process queries it: the slice of it the renderer
// draws, search hits, removals after a trash. A whole disk is millions of
// nodes, too many for V8 to hold comfortably and too long to pass over as
// one JSON string at all. What does cross comes back as JSON strings that
// we JSON.parse here, which beats building V8 objects through N-API one
// property at a time (V8's JSON.parse is optimized C++; per-property napi
// calls round-trip through the binding boundary).

import { app } from "electron";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const nativePath = path.resolve(
	app.getAppPath(),
	"src/scanner/observatory_scan.node",
);

type RawNativeBinding = {
	Scan: RawNativeScanClass;
	volumes(): NativeVolume[];
};

type RawNativeScanClass = {
	new (path: string, options: { perf?: boolean }): RawNativeScan;
	fromJson(json: string): RawNativeScan;
};

interface RawNativeScan {
	start(): Promise<string>;
	progress(): NativeScanProgress;
	abort(): void;
	size(): number | null;
	renderTree(cursor: string[]): string;
	search(basePath: string, query: string): Promise<string>;
	remove(parts: string[]): boolean;
	release(): void;
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

export type NativeScanSummary = {
	// Taken out of the tree (src/scanner/reserved.rs).
	reserved: Ob.ReservedSpace[];
	counts: NativeScanCounts;
	errors: Ob.ScanError[];
	perf: Ob.PerfNode | null;
};

// What the scanner cuts out of the tree for one directory (`RenderSlice` in
// src/scanner/tree.rs). Directories in `list` come without their contents;
// those in `sunburst` keep the ones big enough to draw, six levels down.
export type RenderSlice = {
	// The scan root's name, whichever directory this is.
	name: string;
	rootSize: number;
	position: number;
	size: number;
	list: Ob.VfsNode[];
	sunburst: Ob.VfsNode[];
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

	private constructor(inner: RawNativeScan) {
		this.#inner = inner;
	}

	// Stats `path` right away, throwing if it can't; the walk waits for
	// start().
	static create(path: string, options: { perf?: boolean }): Scan {
		return new Scan(new raw.Scan(path, options));
	}

	// A scan that has already finished, holding `root` as its tree.
	static fromTree(root: Ob.VfsDirectory): Scan {
		return new Scan(raw.Scan.fromJson(JSON.stringify(root)));
	}

	// Resolves once the walk is done, after which the tree is queryable.
	async start(): Promise<NativeScanSummary> {
		return JSON.parse(await this.#inner.start()) as NativeScanSummary;
	}

	progress(): NativeScanProgress {
		return this.#inner.progress();
	}

	abort(): void {
		this.#inner.abort();
	}

	// The rest are for a finished scan, and answer null or false before then.

	size(): number | null {
		return this.#inner.size();
	}

	// Null too if `cursor` doesn't lead to a directory.
	renderTree(cursor: string[]): RenderSlice | null {
		return JSON.parse(this.#inner.renderTree(cursor)) as RenderSlice | null;
	}

	// Runs off the main thread, since it visits every node. Hit paths are
	// built on `basePath`.
	async search(
		basePath: string,
		query: string,
	): Promise<Ob.SearchResults | null> {
		const json = await this.#inner.search(basePath, query);
		return JSON.parse(json) as Ob.SearchResults | null;
	}

	// Takes the entry at `parts` (names below the root) out of the tree.
	// False if it wasn't there.
	remove(parts: string[]): boolean {
		return this.#inner.remove(parts);
	}

	// Frees the tree. V8 can't see its size, so it won't hurry to collect
	// this handle; call this once the scan is done with.
	release(): void {
		this.#inner.release();
	}
}

export type NativeScan = Scan;

// A disk or network share there is to scan (`Volume` in
// src/scanner/volumes.rs).
export type NativeVolume = {
	path: string;
	// Where to ask how full it is, when that isn't `path`.
	usagePath?: string;
	name: string;
	network: boolean;
	startup: boolean;
	external: boolean;
	encrypted: boolean;
	server?: string;
	protocol?: string;
};

// The disks attached to this machine and the shares mounted from others, as
// the OS's file manager would list them. Only reads what the OS already
// knows, so it's quick and never waits on a file server.
export function volumes(): NativeVolume[] {
	return raw.volumes();
}
