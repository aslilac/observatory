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
		function sizeToDisplay(): Promise<void>;
		function sizeToMenu(): Promise<void>;

		// Push events (main -> renderer); each returns an unsubscribe.
		function onDrives(cb: (drives: PhysicalDrive[]) => void): () => void;
		function onScans(cb: (scans: ScanInfo[]) => void): () => void;
		function onSetInspecting(cb: (path: string | null) => void): () => void;

		export interface PhysicalDrive {
			mountPath: string;
			description: string;
		}

		export type ScanStatus = "init" | "building" | "complete";

		export interface ScanInfo {
			path: string;
			status: ScanStatus;
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
			files: VfsNode[];
		};

		export type VfsFile = {
			type: "file";
			name: string;
			size: number;
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
