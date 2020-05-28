import type { VirtualFileSystem } from "./main/vfs";

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

export const DIRECTORY = "VFS/DIRECTORY";
export const FILE = "VFS/FILE";
export const SYMLINK = "VFS/SYMLINK";
export const DEVICE = "VFS/DEVICE";
export const UNKNOWN = "VFS/UNKNOWN";

export type NodeType =
	| typeof DIRECTORY
	| typeof FILE
	| typeof SYMLINK
	| typeof DEVICE
	| typeof UNKNOWN;

export type VfsNode = VfsDirectory | VfsFile;

export type VfsDirectory = {
	type: typeof DIRECTORY;
	name?: string;
	size: number;
	capacity?: number; // for drives
	files: VfsNode[];
};

export type VfsFile = {
	type: typeof FILE;
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
