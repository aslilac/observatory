import type { ContextMenuItem } from "./components/ContextMenu";

const isMac = Ob.platform === "darwin";

type RowActionsArgs = {
	path: string;
	name: string;
	size: number;
	type: "file" | "directory";
	onAddToCleanup: (item: { path: string; name: string; size: number }) => void;
};

// Right-click items shared across LegendList, FolderTree, and SearchResults
// rows. Keeps the four destructive-or-navigational actions the design calls
// for; per-list controls (sort, etc.) live next to their own UI.
export function rowActions({
	path,
	name,
	size,
	type,
	onAddToCleanup,
}: RowActionsArgs): ContextMenuItem[] {
	return [
		{ kind: "item", label: "Open", onClick: () => void Ob.openPath(path) },
		{
			kind: "item",
			label: isMac ? "Reveal in Finder" : "Show in Folder",
			onClick: () => void Ob.revealInFinder(path),
		},
		{
			kind: "item",
			label: "Copy path",
			onClick: () => {
				void navigator.clipboard.writeText(path);
			},
		},
		{ kind: "separator" },
		{
			kind: "item",
			label: type === "directory" ? "Add folder to cleanup" : "Add to cleanup",
			onClick: () => onAddToCleanup({ path, name, size }),
		},
	];
}
