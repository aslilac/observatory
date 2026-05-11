import { shell } from "electron";
import { removePath } from "./vfsManager";

export type DeleteResult = {
	deleted: string[];
	failed: Array<{ path: string; error: string }>;
};

// Move each path to the system Trash via Electron's shell helper.
// Best-effort and per-path: one bad path doesn't abort the rest. Successful
// removals also drop out of any in-memory VFS so the inspect / list / tree
// views stop showing entries that no longer exist on disk.
export async function deleteFiles(paths: string[]): Promise<DeleteResult> {
	const deleted: string[] = [];
	const failed: Array<{ path: string; error: string }> = [];

	await Promise.all(
		paths.map(async (path) => {
			try {
				await shell.trashItem(path);
				deleted.push(path);
			} catch (err) {
				failed.push({
					path,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}),
	);

	for (const path of deleted) {
		removePath(path);
	}

	return { deleted, failed };
}
