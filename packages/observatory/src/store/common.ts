import type { Drive } from "drivelist";
import produce, { enableMapSet } from "immer";

// immer sucks apparently
enableMapSet();

export type AppState = {
	drives: Drive[];
	vfs: Map<string, Ob.VfsState>;
	inspecting: string | null;
};

const init = (): AppState => ({
	drives: [],
	vfs: new Map<string, Ob.VfsState>(),
	inspecting: null,
});

export type Action =
	| ReturnType<typeof propagateDriveList>
	| ReturnType<typeof showDriveList>
	| ReturnType<typeof createVfs>
	| ReturnType<typeof premountVfs>
	| ReturnType<typeof mountVfs>
	| ReturnType<typeof render>
	| ReturnType<typeof inspectVfs>
	| ReturnType<typeof navigateUp>
	| ReturnType<typeof navigateForward>
	| ReturnType<typeof navigateToRoot>
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
export const showDriveList = () => ({
	type: "mckayla.observatory.SHOW_DRIVE_LIST" as const,
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

/**
 * @direction main -> renderer
 */
export const premountVfs = (path: string) => ({
	type: "mckayla.observatory.PREMOUNT_VFS" as const,
	payload: {
		path,
	},
});

/**
 * @direction main -> renderer
 */
export const mountVfs = (path: string, tree: Ob.RenderTree) => ({
	type: "mckayla.observatory.MOUNT_VFS" as const,
	payload: {
		path,
		tree,
	},
});

/**
 * @direction renderer -> main
 */
export const inspectVfs = (path: string) => ({
	type: "mckayla.observatory.INSPECT_VFS" as const,
	payload: {
		path,
	},
});

/**
 * @direction main -> renderer
 */
export const render = (path: string, cursor: string[], tree: Ob.RenderTree) => ({
	type: "mckayla.observatory.RENDER" as const,
	payload: {
		cursor,
		path,
		tree,
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
export const navigateForward = (...into: string[]) => ({
	type: "mckayla.observatory.NAVIGATE_FORWARD" as const,
	payload: {
		into,
	},
});

/**
 * @direction renderer -> main
 */
export const navigateToRoot = () => ({
	type: "mckayla.observatory.NAVIGATE_TO_ROOT" as const,
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
			case "mckayla.observatory.SHOW_DRIVE_LIST":
				draft.inspecting = null;
				break;
			case "mckayla.observatory.CREATE_VFS":
				draft.vfs.set(action.payload.path, { status: "init" });
				break;
			case "mckayla.observatory.PREMOUNT_VFS":
				draft.vfs.set(action.payload.path, {
					status: "building",
				});
				break;
			case "mckayla.observatory.MOUNT_VFS":
				draft.vfs.set(action.payload.path, {
					status: "complete",
					cursor: [],
					currentTree: action.payload.tree,
					outOfDate: false,
				});
				break;
			case "mckayla.observatory.INSPECT_VFS":
				draft.inspecting = action.payload.path;
				break;
			case "mckayla.observatory.RENDER":
				draft.inspecting = action.payload.path;
				draft.vfs.set(action.payload.path, {
					status: "complete",
					cursor: action.payload.cursor,
					currentTree: action.payload.tree,
					outOfDate: false,
				});
				break;
			case "mckayla.observatory.NAVIGATE_UP": {
				const current = draft.vfs.get(draft.inspecting!);

				if (current?.status !== "complete") {
					console.error(
						new Error("Attemted to NAVIGATE_UP on a nonexistent cursor"),
					);
					return;
				}

				// Only navigate up if we can
				if (!current.cursor.length) {
					return;
				}

				draft.vfs.set(draft.inspecting!, {
					status: "complete",
					cursor: current.cursor.slice(0, -1),
					currentTree: current.currentTree,
					outOfDate: true,
				});
				break;
			}
			case "mckayla.observatory.NAVIGATE_FORWARD": {
				const current = draft.vfs.get(draft.inspecting!);

				if (current?.status !== "complete") {
					console.error(
						new Error("Attemted to NAVIGATE_FORWARD on a nonexistent cursor"),
					);
					return;
				}

				draft.vfs.set(draft.inspecting!, {
					status: "complete",
					cursor: [...current.cursor, ...action.payload.into],
					currentTree: current.currentTree,
					outOfDate: true,
				});
				break;
			}
			case "mckayla.observatory.NAVIGATE_TO_ROOT": {
				const current = draft.vfs.get(draft.inspecting!);

				if (current?.status !== "complete") {
					console.error(
						new Error("Attemted to NAVIGATE_TO_ROOT on a nonexistent cursor"),
					);
					return;
				}
				// Only navigate up if we can
				if (!current.cursor.length) {
					return;
				}

				draft.vfs.set(draft.inspecting!, {
					status: "complete",
					cursor: [],
					currentTree: current.currentTree,
					outOfDate: true,
				});
				break;
			}
			case "mckayla.observatory.NAVIGATE_TO": {
				const current = draft.vfs.get(draft.inspecting!);

				if (current?.status !== "complete") {
					console.error(
						new Error("Attemted to NAVIGATE_TO on a nonexistent cursor"),
					);
					return;
				}

				// Only navigate up if we can
				if (!current.cursor.length) {
					return;
				}

				// A bunch of stuff to prevent navigating to the same place
				const currentCursor = current.cursor;
				const proposedCursor = action.payload.cursor;

				if (currentCursor.length === proposedCursor.length) {
					if (currentCursor.every((item, i) => item === proposedCursor[i])) {
						return;
					}
				}

				draft.vfs.set(draft.inspecting!, {
					status: "complete",
					cursor: action.payload.cursor,
					currentTree: current.currentTree,
					outOfDate: true,
				});
				break;
			}
		}
	});
};
