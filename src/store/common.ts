import { Drive } from "drivelist";
import produce, { enableMapSet } from "immer";

// immer sucks apparently
enableMapSet();

import { VfsState, VirtualFileSystem as Vfs } from "../main/vfs";

type AppState = {
	drives: Drive[];
	vfs: Map<string, VfsState>;
	screen: Screen;
};

type Screen =
	| {
			route: "menu" | "loading";
	  }
	| { route: "display"; fragment: any };

const init = (): AppState => ({
	drives: [],
	vfs: new Map(),
	screen: {
		route: "menu",
	},
});

type Action =
	| ReturnType<typeof propagateDriveList>
	| ReturnType<typeof createVfs>
	| ReturnType<typeof premountVfs>
	| ReturnType<typeof mountVfs>
	| ReturnType<typeof render>
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
	meta: {
		scope: "local",
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
	meta: {
		scope: "local",
	},
});

/**
 * @direction main -> renderer
 */
export const render = (trimmed: any) => ({
	type: "mckayla.observatory.RENDER" as const,
	payload: {
		trimmed,
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
					vfs: action.payload.vfs,
					cursor: [],
				});
				break;
			case "mckayla.observatory.MOUNT_VFS":
				draft.vfs.set(action.payload.path, {
					status: "complete",
					vfs: action.payload.vfs,
					cursor: [],
				});
				break;
			case "mckayla.observatory.RENDER":
				draft.currentTree = action.payload.trimmed;
				break;
		}
	});
};
