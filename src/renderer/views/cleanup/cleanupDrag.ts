import { useEffect, useState } from "react";

import { readableSize } from "#/format";
import { useCleanupQueue } from "#/state";
import type { SelectableItem } from "../inspect/types";

// What rows and wedges carry when they're dragged, for the cleanup panel and
// chip to take. Their paths go along as text too, for anywhere else they're
// dropped (a terminal, an editor). Files dragged in from outside the window
// carry neither, and start a scan instead (DragReceiver).
const TYPE = "application/x-observatory-items";

export function startCleanupDrag(e: React.DragEvent, items: SelectableItem[]) {
	e.dataTransfer.effectAllowed = "copy";
	e.dataTransfer.setData(TYPE, JSON.stringify(items));
	e.dataTransfer.setData("text/plain", items.map((i) => i.path).join("\n"));
	e.dataTransfer.setDragImage(dragImage(items), -12, -12);
}

const carriesItems = (e: React.DragEvent | DragEvent) =>
	Boolean(e.dataTransfer?.types.includes(TYPE));

// A pill naming what's dragged, rather than a picture of the row or the whole
// sunburst. It only has to be on the page while the drag starts.
function dragImage(items: SelectableItem[]): HTMLElement {
	const size = items.reduce((sum, i) => sum + i.size, 0);
	const pill = document.createElement("div");
	pill.className =
		"fixed -top-[200px] left-0 flex max-w-[280px] gap-[8px] rounded-full bg-default px-[12px] py-[5px] text-[12px] font-medium text-background";
	const name = document.createElement("span");
	name.className = "truncate";
	name.textContent =
		items.length === 1 ? items[0]!.name : `${items.length} items`;
	const amount = document.createElement("span");
	amount.className = "tabular-nums opacity-70";
	amount.textContent = readableSize(size);
	pill.append(name, amount);
	document.body.append(pill);
	setTimeout(() => pill.remove());
	return pill;
}

// Whether something is being dragged that the cleanup would take, wherever
// it is in the window, so drop targets can show themselves.
export function useCleanupDragging(): boolean {
	const [dragging, setDragging] = useState(false);
	useEffect(() => {
		const start = (e: DragEvent) => {
			if (carriesItems(e)) {
				setDragging(true);
			}
		};
		const end = () => setDragging(false);
		document.addEventListener("dragstart", start);
		document.addEventListener("dragend", end);
		document.addEventListener("drop", end);
		return () => {
			document.removeEventListener("dragstart", start);
			document.removeEventListener("dragend", end);
			document.removeEventListener("drop", end);
		};
	}, []);
	return dragging;
}

// Props for an element that moves what's dropped on it to cleanup, and
// whether something is over it now.
export function useCleanupDrop(): {
	over: boolean;
	dropProps: React.HTMLAttributes<HTMLElement>;
} {
	const { add } = useCleanupQueue();
	const [over, setOver] = useState(false);
	const dropProps: React.HTMLAttributes<HTMLElement> = {
		onDragEnter: (e) => {
			if (carriesItems(e)) {
				e.preventDefault();
				setOver(true);
			}
		},
		onDragOver: (e) => {
			if (carriesItems(e)) {
				e.preventDefault();
				e.dataTransfer.dropEffect = "copy";
			}
		},
		onDragLeave: (e) => {
			// It fires for every child the pointer crosses into, too.
			if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
				setOver(false);
			}
		},
		onDrop: (e) => {
			if (!carriesItems(e)) {
				return;
			}
			e.preventDefault();
			setOver(false);
			try {
				add(JSON.parse(e.dataTransfer.getData(TYPE)) as SelectableItem[]);
			} catch {
				// Not something this window dragged.
			}
		},
	};
	return { over, dropProps };
}

// What dragging `item` takes: everything selected, if it's among them.
export function draggedWith(
	item: SelectableItem,
	selection: Map<string, SelectableItem>,
): SelectableItem[] {
	return selection.has(item.path) ? [...selection.values()] : [item];
}
