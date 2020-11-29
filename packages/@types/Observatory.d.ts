import type { VirtualFileSystem } from "observatory";

declare global {
	namespace Ob {
		export type { VirtualFileSystem };

		export type VfsState =
			| {
					status: "init" | "building";
			  }
			| {
					status: "complete";
					cursor: string[];
					currentTree: RenderTree | null;
					outOfDate: boolean;
			  };

		export type NodeType =
			| "directory"
			| "file"
			| "symlink"
			| "device"
			| "unknown";

		export type VfsNode = VfsDirectory | VfsFile;

		export type VfsDirectory = {
			type: "directory";
			name?: string;
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
