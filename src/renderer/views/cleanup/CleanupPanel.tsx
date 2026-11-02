import { useMemo, useState } from "react";

import { FileIcon, FolderIcon, Trash2Icon, XIcon } from "lucide-react";

import { queuedActions } from "#/contextActions";
import { readableSize } from "#/format";
import { basename } from "#/paths";
import { type CleanupItem, useCleanupQueue } from "#/state";
import { Button } from "#/components/Button";
import { RowMenu } from "#/components/ContextMenu";
import { useCleanupDragging, useCleanupDrop } from "./cleanupDrag";
import { CleanupModal } from "./CleanupModal";

// What's been moved to cleanup, in a drawer that slides out over whatever
// the window is showing, so you can keep browsing while you fill it, and
// drop things straight onto it. It hangs below the toolbar, so the
// CleanupChip that opens and closes it stays in reach.
export const CleanupPanel: React.FC = () => {
	const { items, totalSize, remove, clear, panelOpen, setPanelOpen } =
		useCleanupQueue();
	const dragging = useCleanupDragging();
	const { over, dropProps } = useCleanupDrop();
	const [confirming, setConfirming] = useState(false);
	const largestFirst = useMemo(
		() => items.toSorted((a, b) => b.size - a.size),
		[items],
	);

	return (
		<aside
			inert={!panelOpen}
			className={`absolute top-[44px] right-0 bottom-0 z-[5] flex w-[300px] flex-col border-l border-line-soft transition-transform duration-200 ease-out motion-reduce:transition-none ${panelOpen ? "translate-x-0 shadow-[-12px_0_30px_-12px_rgba(0,0,0,0.25)]" : "translate-x-full"} ${over ? "bg-fill" : "bg-background"}`}
			{...dropProps}
		>
			<div className="flex h-[44px] flex-shrink-0 items-center gap-[8px] border-b border-line-soft pr-[8px] pl-[14px]">
				<Trash2Icon size={14} strokeWidth={1.8} className="text-muted" />
				<div className="flex-1 text-[13px] font-semibold">Cleanup</div>
				<button
					type="button"
					onClick={() => setPanelOpen(false)}
					title="Close"
					className="grid size-[26px] cursor-pointer place-items-center rounded-button text-muted hover:bg-fill hover:text-default"
				>
					<XIcon size={14} strokeWidth={1.8} />
				</button>
			</div>
			{items.length === 0 ? (
				<Empty dragging={dragging} />
			) : (
				<>
					<div className="min-h-0 flex-1 overflow-auto p-[8px]">
						{dragging && <DropHint />}
						{largestFirst.map((item) => (
							<Row
								key={item.path}
								item={item}
								onRemove={() => remove(item.path)}
							/>
						))}
					</div>
					<div className="flex-shrink-0 border-t border-line-soft p-[14px]">
						<div className="mb-[12px] flex items-baseline justify-between">
							<span className="text-[12px] text-muted tabular-nums">
								{items.length} item{items.length === 1 ? "" : "s"}
							</span>
							<span className="text-[20px] font-semibold tabular-nums">
								{readableSize(totalSize)}
							</span>
						</div>
						<div className="flex gap-[8px]">
							<Button onClick={clear}>Clear</Button>
							<Button
								variant="danger"
								className="flex-1 justify-center"
								onClick={() => setConfirming(true)}
							>
								Delete…
							</Button>
						</div>
					</div>
				</>
			)}
			{confirming && (
				<CleanupModal
					items={largestFirst}
					totalSize={totalSize}
					onClose={() => setConfirming(false)}
				/>
			)}
		</aside>
	);
};

type RowProps = {
	item: CleanupItem;
	onRemove: () => void;
};

const Row: React.FC<RowProps> = ({ item, onRemove }) => {
	const parent = basename(item.path.slice(0, -item.name.length));
	return (
		<RowMenu
			items={queuedActions(item.path, onRemove)}
			title={item.path}
			className="group flex items-center gap-[10px] rounded-[5px] px-[8px] py-[6px] hover:bg-fill"
		>
			<span className="flex-shrink-0 text-faint">
				{item.type === "file" ? (
					<FileIcon size={14} strokeWidth={1.6} />
				) : (
					<FolderIcon size={14} strokeWidth={1.6} />
				)}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[13px]">{item.name}</span>
				{parent && (
					<span className="block truncate text-[11px] text-faint">
						in {parent}
					</span>
				)}
			</span>
			<span className="flex-shrink-0 text-[12px] text-muted tabular-nums group-hover:hidden">
				{readableSize(item.size)}
			</span>
			<button
				type="button"
				onClick={onRemove}
				title="Remove from cleanup"
				className="hidden size-[22px] flex-shrink-0 cursor-pointer place-items-center rounded-button text-muted group-hover:grid hover:bg-fill-strong hover:text-default"
			>
				<XIcon size={13} strokeWidth={1.8} />
			</button>
		</RowMenu>
	);
};

const DropHint: React.FC = () => (
	<div className="mb-[6px] rounded-card border border-dashed border-meter px-[10px] py-[10px] text-center text-[12px] text-muted">
		Drop to move to cleanup
	</div>
);

const Empty: React.FC<{ dragging: boolean }> = ({ dragging }) => (
	<div
		className={`m-[12px] flex flex-1 flex-col items-center justify-center gap-[10px] rounded-card border border-dashed px-[24px] text-center ${dragging ? "border-meter" : "border-transparent"}`}
	>
		<Trash2Icon size={22} strokeWidth={1.4} className="text-faint" />
		<div className="text-[13px] font-semibold">Nothing to clean up</div>
		<div className="text-[12px] text-muted">
			{dragging
				? "Drop it here to move it to cleanup."
				: "Drag files and folders here, or right-click one and choose Move to cleanup."}
		</div>
	</div>
);
