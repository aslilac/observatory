import { shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { removePath } from "./vfsManager";

// Delete each path for good, or move it to the system Trash. Best-effort and
// per-path: one bad path doesn't abort the rest. Something that's already
// gone counts as deleted, so it leaves the queue. Successful removals also
// drop out of any in-memory VFS so the inspect / list / tree views stop
// showing entries that no longer exist on disk.
export async function deleteFiles(
	paths: string[],
	mode: Ob.DeleteMode,
): Promise<Ob.DeleteResult> {
	const deleted: string[] = [];
	const failed: Array<{ path: string; error: string }> = [];

	await Promise.all(
		paths.map(async (target) => {
			try {
				// Never a whole disk, and never somewhere relative to wherever
				// the app happens to be running.
				if (!path.isAbsolute(target) || path.dirname(target) === target) {
					throw new Error("Not something that can be deleted");
				}
				if (await exists(target)) {
					if (mode === "trash") {
						await shell.trashItem(target);
					} else {
						await fs.rm(target, { recursive: true });
					}
				}
				deleted.push(target);
			} catch (err) {
				failed.push({
					path: target,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}),
	);

	for (const target of deleted) {
		removePath(target);
	}

	return { deleted, failed };
}

async function exists(target: string): Promise<boolean> {
	try {
		await fs.lstat(target);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw err;
	}
}
