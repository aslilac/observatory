declare global {
	namespace Ob {
		const platform: "darwin" | "linux" | "win32";

		// RPC (renderer -> main)
		function selectDirectory(): Promise<void>;
		function scanPath(path: string): Promise<void>;
		function cancelScan(path: string): Promise<void>;
		function getDrives(): Promise<PhysicalDrive[]>;
		function getScans(): Promise<ScanInfo[]>;
		function getRenderTree(
			path: string,
			cursor: string[],
		): Promise<RenderTree | null>;
		function getScanProgress(path: string): Promise<ScanProgress | null>;
		function deleteFiles(paths: string[]): Promise<DeleteResult>;
		function searchScan(
			path: string,
			query: string,
		): Promise<SearchResults | null>;
		function getScanErrors(path: string): Promise<ScanError[]>;
		function statPath(path: string): Promise<PathStat | null>;
		function pathForFile(file: File): string;
		function publishRecentScans(
			recents: ReadonlyArray<{ path: string; scannedAt: number }>,
		): Promise<void>;
		function revealInFinder(path: string): Promise<void>;
		function openPath(path: string): Promise<string>;

		// Push events (main -> renderer); each returns an unsubscribe.
		function onDrives(cb: (drives: PhysicalDrive[]) => void): () => void;
		function onScans(cb: (scans: ScanInfo[]) => void): () => void;
		function onSetInspecting(cb: (path: string | null) => void): () => void;
		function onNav(cb: (direction: "back" | "forward") => void): () => void;

		export interface PhysicalDrive {
			mountPath: string;
			description: string;
		}

		export type ScanStatus = "init" | "building" | "complete";

		export interface ScanInfo {
			path: string;
			status: ScanStatus;
			// Only set once the scan has completed.
			size?: number;
			// Bumped whenever the VFS for this scan is mutated (e.g. after
			// trash). Lets the renderer key its render-tree fetch on it.
			revision: number;
		}

		export interface DeleteResult {
			deleted: string[];
			failed: Array<{ path: string; error: string }>;
		}

		export interface SearchMatch {
			path: string;
			size: number;
			type: "file" | "directory";
		}

		export interface SearchResults {
			matches: SearchMatch[];
			totalCount: number;
			totalSize: number;
			truncated: boolean;
		}

		export interface ScanError {
			path: string;
			kind: "permission" | "missing" | "loop" | "other";
			code: string | null;
			message: string;
		}

		export interface PathStat {
			exists: boolean;
			isDirectory: boolean;
		}

		export interface ScanProgress {
			path: string;
			status: ScanStatus;
			counts: {
				files: number;
				directories: number;
				symlinks: number;
				devices: number;
				misc: number;
			};
			currentPath: string | null;
			// Top-N slowest directories observed so far, ordered by self-time
			// descending. Only populated when the main process is running with
			// OB_PERF=1.
			slowest?: DirectoryPerf[];
		}

		export interface DirectoryPerf {
			path: string;
			// Wall time of the recursive _scan for this directory, including
			// all descendants.
			totalMs: number;
			// totalMs minus the slowest immediate child's totalMs. Approximates
			// "what would this _scan have cost if its children were free?" —
			// useful for spotting individual heavy directories rather than
			// just-large subtrees.
			selfMs: number;
			// Time spent in the readdir() call alone.
			readdirMs: number;
			// Number of immediate entries (files + dirs + other).
			entryCount: number;
			// 0 = scan root.
			depth: number;
		}

		export type NodeType =
			| "directory"
			| "file"
			| "symlink"
			| "device"
			| "unknown";
		export type NodeType$ = NodeType | "imaginary";

		export type VfsNode = VfsDirectory | VfsFile;

		export type VfsDirectory = {
			type: "directory";
			name: string;
			size: number;
			capacity?: number; // for drives
			// Latest mtime among this directory and all its descendants (epoch
			// ms). Useful for "what's been touched recently" sorting.
			mtime: number;
			files: VfsNode[];
		};

		export type VfsFile = {
			type: "file";
			name: string;
			size: number;
			mtime: number;
		};

		export type DisplayInfo = {
			files: VfsNode[];
		};

		export type RenderTree = {
			name: string;
			cursor: string[];
			type: NodeType;
			rootCapacity: number;
			rootSize: number;
			capacity: number;
			position: number;
			size: number;
			list: DisplayInfo;
			sunburst: DisplayInfo;
			// Full recursive directory listing for the tree view: every child
			// of every descendant up to a fixed depth, alphabetically sorted at
			// each level. Unlike `sunburst.files` it isn't filtered by size, so
			// the tree shows tiny entries the sunburst would drop.
			tree: DisplayInfo;
		};
	}
}

export {};
