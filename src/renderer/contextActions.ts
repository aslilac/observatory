import type { ContextMenuItem } from "./components/ContextMenu";

const isMac = Ob.platform === "darwin";
const meta = isMac ? "⌘" : "Ctrl+";

type RowActionsArgs = {
	path: string;
	name: string;
	size: number;
	type: "file" | "directory";
	onAddToCleanup: (item: { path: string; name: string; size: number }) => void;
};

// The menu the design calls for on a file/folder row: open, reveal, copy,
// add to cleanup. Sort actions are list-scoped so they're emitted by
// LegendList itself rather than this shared builder.
export function rowActions({
	path,
	name,
	size,
	type,
	onAddToCleanup,
}: RowActionsArgs): ContextMenuItem[] {
	return [
		{
			kind: "item",
			label: "Open",
			accelerator: "↵",
			onClick: () => void Ob.openPath(path),
		},
		{
			kind: "item",
			label: isMac ? "Reveal in Finder" : "Show in Folder",
			accelerator: `${meta}R`,
			onClick: () => void Ob.revealInFinder(path),
		},
		{
			kind: "item",
			label: "Copy path",
			accelerator: `${meta}C`,
			onClick: () => {
				void navigator.clipboard.writeText(path);
			},
		},
		{ kind: "separator" },
		{
			kind: "item",
			label: type === "directory" ? "Add folder to cleanup" : "Add to cleanup",
			accelerator: `${meta}⏎`,
			onClick: () => onAddToCleanup({ path, name, size }),
		},
	];
}
