import { shell } from "electron";

export type DeleteResult = {
	deleted: string[];
	failed: Array<{ path: string; error: string }>;
};

// Move each path to the system Trash via Electron's shell helper.
// Best-effort and per-path: one bad path doesn't abort the rest.
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

	return { deleted, failed };
}
