import { Trash2Icon } from "lucide-react";

import { useCleanupQueue } from "#/state";
import { readableSize } from "#/format";
import { useCleanupDragging, useCleanupDrop } from "./cleanupDrag";

// Opens and closes the CleanupPanel, and says how much is in it. Rows and
// wedges can be dropped on it too, with the panel closed.
export const CleanupChip: React.FC = () => {
	const { items, totalSize, panelOpen, setPanelOpen } = useCleanupQueue();
	const dragging = useCleanupDragging();
	const { over, dropProps } = useCleanupDrop();
	const count = items.length;

	const look = dragging
		? `border-dashed border-meter text-default ${over ? "bg-meter/20" : "bg-meter/8"}`
		: panelOpen
			? "border-line bg-fill text-default"
			: count > 0
				? "border-line bg-background text-default hover:bg-fill"
				: "border-dashed border-line text-muted hover:bg-fill hover:text-default";

	return (
		<button
			type="button"
			onClick={() => setPanelOpen(!panelOpen)}
			aria-pressed={panelOpen}
			title={
				count > 0
					? `${count} item${count === 1 ? "" : "s"} to clean up`
					: "Cleanup"
			}
			className={`ml-[6px] inline-flex h-[28px] cursor-pointer items-center gap-[6px] rounded-full border pl-[10px] text-[11px] font-medium ${count > 0 ? "pr-[4px]" : "pr-[10px]"} ${look}`}
			{...dropProps}
		>
			<Trash2Icon size={12} strokeWidth={1.8} />
			Cleanup
			{count > 0 && (
				<span className="rounded-full bg-fill-strong px-[8px] py-[2px] text-[10px] font-semibold tabular-nums">
					{readableSize(totalSize)}
				</span>
			)}
		</button>
	);
};
