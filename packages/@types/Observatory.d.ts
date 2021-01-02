declare global {
	namespace Ob {
		const platform: "darwin" | "linux" | "win32";
		function selectDirectory(): Promise<string[]>;

		export interface VirtualFileSystem {
			location: string;
			root: VfsDirectory | null;

			getRenderTree(cursor: string[]): RenderTree;
		}

		export type VfsState =
			| {
					status: "init" | "building";
					cursor?: undefined;
					currentTree?: undefined;
					outOfDate?: undefined;
			  }
			| {
					status: "complete";
					cursor: string[];
					currentTree: RenderTree | null;
					outOfDate: boolean;
			  };

		export type NodeType = "directory" | "file" | "symlink" | "device" | "unknown";

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
