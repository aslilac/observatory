// Pruning logic that turns a fully-scanned VfsDirectory into the shape
// the renderer consumes. Lives in its own file (rather than as a method
// on VirtualFileSystem) because the native scanner just produces a
// VfsDirectory — there's no class to hang the method on, and the pruning
// is pure tree-shape transformation either way.
//
// Three views of the same directory:
//   list      — all immediate children, as-is order (size desc from scan)
//   sunburst  — drop anything < 0.3% of the parent, recurse 6 levels
//   tree      — alphabetical, immediate children only (FolderTree fetches
//               deeper levels lazily via a fresh getRenderTree(subCursor))

export function buildRenderTree(
	root: Ob.VfsDirectory,
	cursor: string[],
): Ob.RenderTree | null {
	const directory = walkToCursor(root, cursor);
	if (!directory) {
		return null;
	}

	const isLargeEnough = (file: Ob.VfsNode) =>
		file.size > directory.size * 0.003;

	const sanitize =
		(recursive = 0) =>
		(file: Ob.VfsNode): Ob.VfsNode =>
			file.type === "directory"
				? {
						name: file.name,
						type: file.type,
						size: file.size,
						mtime: file.mtime,
						files:
							recursive > 0 && file.type === "directory"
								? file.files.filter(isLargeEnough).map(sanitize(recursive - 1))
								: [],
					}
				: {
						name: file.name,
						type: file.type,
						size: file.size,
						mtime: file.mtime,
					};

	const sortAlpha = (files: Ob.VfsNode[]) =>
		files
			.slice()
			.sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			);

	return {
		name: root.name,
		cursor,
		type: "directory",
		rootCapacity: root.capacity || root.size,
		rootSize: root.size,
		capacity: directory.capacity || directory.size,
		position: directory.position,
		size: directory.size,
		list: {
			files: directory.files.map(sanitize()),
		},
		sunburst: {
			files: directory.files.filter(isLargeEnough).map(sanitize(6)),
		},
		tree: {
			// Only ship immediate children — the FolderTree component lazily
			// fetches deeper levels via getRenderTree(subCursor), so a
			// recursive payload here would balloon to tens of MB on dense
			// scans without buying anything the user can see yet.
			files: sortAlpha(directory.files).map(sanitize()),
		},
	};
}

// Walk the cursor through `root.files`, returning the resolved directory
// plus its `position` (the cumulative size fraction of preceding siblings,
// expressed against root.size — used to anchor the sunburst slice when the
// user has drilled in). Returns false if any cursor segment doesn't
// resolve to a directory.
function walkToCursor(
	root: Ob.VfsDirectory,
	cursor: string[],
): false | (Ob.VfsDirectory & { position: number }) {
	const scale = root.size;
	let position = 0;
	let current = root;
	const correct = cursor.every((piece) =>
		current.files.some((file) => {
			if (file.name === piece && file.type === "directory") {
				current = file;
				return true;
			}
			position += file.size / scale;
			return false;
		}),
	);

	return correct && { position, ...current };
}
