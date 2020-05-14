import { Drive } from "drivelist";
import produce, { enableMapSet } from "immer";

// immer sucks apparently
enableMapSet();

import type { VfsState, VirtualFileSystem as Vfs, RenderTree } from "../types";

// type VfsState = any;
// type Vfs = any;
// type RenderTree = any;

export type AppState = {
	drives: Drive[];
	vfs: Map<string, VfsState>;
	inspecting?: string;
	currentTree?: RenderTree;
};

const init = (): AppState => ({
	drives: [],
	vfs: new Map(),
});

// This function does nothing, and is just a semi-janky (but less janky than some
// alternatives) way to esnure our action creators return flux actions.
const flux = <T extends string, P = undefined, M = undefined>(action: {
	type: T;
	payload?: P;
	meta?: M;
}) => action;

type Action =
	| ReturnType<typeof propagateDriveList>
	| ReturnType<typeof createVfs>
	| ReturnType<typeof premountVfs>
	| ReturnType<typeof mountVfs>
	| ReturnType<typeof render>
	| ReturnType<typeof inspectVfs>
	| ReturnType<typeof navigateUp>
	| ReturnType<typeof navigateForward>
	| ReturnType<typeof navigateTo>;

/**
 * @direction main -> renderer
 */
export const propagateDriveList = (drives: Drive[]) => ({
	type: "mckayla.observatory.PROPAGATE_DRIVE_LIST" as const,
	payload: {
		drives,
	},
});

/**
 * @direction renderer -> main
 */
export const createVfs = (path: string) => ({
	type: "mckayla.observatory.CREATE_VFS" as const,
	payload: {
		path,
	},
});

export const premountVfs = (path: string, vfs?: Vfs) => ({
	type: "mckayla.observatory.PREMOUNT_VFS" as const,
	payload: {
		path,
		vfs,
	},
});

/**
 * @direction main -> x
 */
export const mountVfs = (path: string, vfs: Vfs) => ({
	type: "mckayla.observatory.MOUNT_VFS" as const,
	payload: {
		path,
		vfs,
	},
});

/**
 * @direction main -> renderer
 */
export const render = (tree: RenderTree) => ({
	type: "mckayla.observatory.RENDER" as const,
	payload: {
		tree,
	},
});

/**
 * @direction renderer -> main
 */
export const inspectVfs = (vfs: string) => ({
	type: "mckayla.observatory.INSPECT_VFS" as const,
	payload: {
		inspecting: vfs,
	},
});

/**
 * @direction renderer -> main
 */
export const navigateUp = () => ({
	type: "mckayla.observatory.NAVIGATE_UP" as const,
});

/**
 * @direction renderer -> main
 */
export const navigateForward = (into: string) => ({
	type: "mckayla.observatory.NAVIGATE_FORWARD" as const,
	payload: {
		into,
	},
});

/**
 * @direction renderer -> main
 */
export const navigateTo = (cursor: string[]) => ({
	type: "mckayla.observatory.NAVIGATE_TO" as const,
	payload: {
		cursor,
	},
});

export const reducer = (state = init(), action: Action): AppState => {
	return produce(state, (draft) => {
		switch (action.type) {
			case "mckayla.observatory.PROPAGATE_DRIVE_LIST":
				draft.drives = action.payload.drives;
				break;
			case "mckayla.observatory.CREATE_VFS":
				draft.vfs.set(action.payload.path, { status: "init" });
				break;
			case "mckayla.observatory.PREMOUNT_VFS":
				draft.vfs.set(action.payload.path, {
					status: "building",
					// vfs: action.payload.vfs,
					cursor: [],
				});
				break;
			case "mckayla.observatory.MOUNT_VFS":
				draft.vfs.set(action.payload.path, {
					status: "complete",
					// vfs: action.payload.vfs,
					vfs: { hello: "friend" },
					cursor: [],
				});
				break;
			case "mckayla.observatory.RENDER":
				draft.currentTree = action.payload.tree;
				break;
		}
	});
};
