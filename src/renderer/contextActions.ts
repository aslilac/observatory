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
	const items: ContextMenuItem[] = [];
	// "Open" on a folder lands in Finder showing the folder's contents, which
	// is identical to what "Reveal in Finder" does for the same folder — only
	// emit it for files where "open with default app" is meaningfully
	// different from "show in parent folder".
	if (type === "file") {
		items.push({
			kind: "item",
			label: "Open",
			onClick: () => void Ob.openPath(path),
		});
	}
	items.push(
		...locationActions(path),
		{ kind: "separator" },
		{
			kind: "item",
			label: type === "directory" ? "Add folder to cleanup" : "Add to cleanup",
			onClick: () => onAddToCleanup({ path, name, size }),
		},
	);
	return items;
}

type PlaceActionsArgs = {
	// For recents: the menu is the only way to take one off the list.
	onRemove?: () => void;
};

// Right-click items for a disk or recent folder on the welcome page.
export function placeActions(
	path: string,
	{ onRemove }: PlaceActionsArgs = {},
): ContextMenuItem[] {
	const items = locationActions(path);
	if (onRemove) {
		items.push(
			{ kind: "separator" },
			{ kind: "item", label: "Remove from recents", onClick: onRemove },
		);
	}
	return items;
}

function locationActions(path: string): ContextMenuItem[] {
	return [
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
	];
}
