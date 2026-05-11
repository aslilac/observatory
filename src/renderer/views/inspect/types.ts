// Lightweight payload for "user has picked this row" — the cleanup queue
// stores a richer CleanupItem (state.tsx) but we don't carry the timestamp
// around the inspect views, so the picker uses this slimmer shape.
export type SelectableItem = {
	path: string;
	name: string;
	size: number;
};

// Props common to both list-style file views (LegendList, FolderTree). Each
// view extends this with its own ordering / display knobs.
export type FileListBaseProps = {
	inspecting: string;
	cursor: string[];
	files: Ob.VfsNode[];
	hueByName: Map<string, number>;
	selection: Map<string, SelectableItem>;
	onToggleSelect: (item: SelectableItem) => void;
	onAddToCleanup: (item: SelectableItem) => void;
};

// Per-row derivations every file list needs. Centralising these keeps the
// two list views rendering the same payload for the same inputs.
export function selectableFromFile(
	file: Ob.VfsNode,
	fullPath: string,
): { fullPath: string; item: SelectableItem; isDir: boolean } {
	return {
		fullPath,
		item: { path: fullPath, name: file.name, size: file.size },
		isDir: file.type === "directory",
	};
}
