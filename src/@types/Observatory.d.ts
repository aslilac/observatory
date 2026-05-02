declare global {
	namespace Ob {
		const platform: "darwin" | "linux" | "win32";

		// RPC (renderer -> main)
		function selectDirectory(): Promise<void>;
		function scanPath(path: string): Promise<void>;
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
		};
	}
}

export {};
