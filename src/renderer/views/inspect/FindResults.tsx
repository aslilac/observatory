import { ChevronLeftIcon, FileIcon, FolderIcon } from "lucide-react";

import { rowActions } from "#/contextActions";
import { readableDate, readableSize } from "#/format";
import { basename } from "#/paths";
import { useCleanupQueue } from "#/state";
import { Button } from "#/components/Button";
import { Checkbox } from "#/components/Checkbox";
import { RowMenu } from "#/components/ContextMenu";
import { draggedWith, startCleanupDrag } from "../cleanup/cleanupDrag";
import type { SelectableItem } from "./types";

type FindResultsProps = {
	title: string;
	scopeName: string;
	found: Ob.Found | null;
	loading: boolean;
	// When each match last changed, for finders that go by it.
	showDates: boolean;
	// The folder the sunburst shows, whose row is marked.
	viewing: string;
	selection: Map<string, SelectableItem>;
	onToggleSelect: (item: SelectableItem) => void;
	onMoveToCleanup: (items: SelectableItem[]) => void;
	// Shows a folder that matched, `within` the folder being looked in.
	onOpen: (within: string[]) => void;
	// Back to the list.
	onClose: () => void;
};

export const FindResults: React.FC<FindResultsProps> = ({
	title,
	scopeName,
	found,
	loading,
	showDates,
	viewing,
	selection,
	onToggleSelect,
	onMoveToCleanup,
	onOpen,
	onClose,
}) => {
	const { includes: inCleanup } = useCleanupQueue();
	const items = (found?.matches ?? []).map((match): SelectableItem => ({
		path: match.path,
		name: basename(match.path),
		size: match.size,
		type: match.type,
	}));
	const outstanding = items.filter((item) => !inCleanup(item.path));

	return (
		<div className="flex flex-col text-[13px]">
			<div className="mb-1 flex items-start gap-[6px] border-b border-line py-[8px] pr-[4px] pl-[4px]">
				<button
					type="button"
					onClick={onClose}
					title="Back to the list"
					className="-ml-[4px] grid size-[22px] flex-shrink-0 cursor-pointer place-items-center rounded-button text-muted hover:bg-fill hover:text-default"
				>
					<ChevronLeftIcon size={15} strokeWidth={1.8} />
				</button>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[14px] font-semibold">{title}</div>
					<div className="truncate text-[12px] text-muted tabular-nums">
						{found
							? `${found.totalCount.toLocaleString()} ${found.totalCount === 1 ? "item" : "items"} in ${scopeName}`
							: `In ${scopeName}`}
					</div>
				</div>
				{found && found.totalCount > 0 && (
					<div className="flex flex-shrink-0 flex-col items-end gap-[6px]">
						<div className="text-[13px] tabular-nums">
							{readableSize(found.totalSize)}
						</div>
						<Button
							size="small"
							disabled={outstanding.length === 0}
							onClick={() => onMoveToCleanup(outstanding)}
						>
							{found.truncated
								? `Move top ${items.length} to cleanup`
								: "Move all to cleanup"}
						</Button>
					</div>
				)}
			</div>

			{!found || found.matches.length === 0 ? (
				<div className="py-[40px] text-center text-[12px] text-muted">
					{loading ? "Looking…" : "Nothing here."}
				</div>
			) : (
				<div className={loading ? "opacity-60" : undefined}>
					{found.matches.map((match, i) => {
						const item = items[i]!;
						const isDir = match.type === "directory";
						const isSelected = selection.has(match.path);
						const queued = inCleanup(match.path);
						return (
							<RowMenu
								key={match.path}
								onClick={() =>
									isDir
										? onOpen([...match.within, item.name])
										: onToggleSelect(item)
								}
								onDragStart={(e) =>
									startCleanupDrag(e, draggedWith(item, selection))
								}
								items={rowActions(item, (one) => onMoveToCleanup([one]))}
								title={match.path}
								className={`group flex items-center gap-[8px] rounded-[5px] px-[8px] py-[6px] ${
									isSelected || match.path === viewing
										? "bg-fill"
										: "hover:bg-fill"
								} ${isDir ? "cursor-pointer" : ""}`}
							>
								<Checkbox
									checked={isSelected}
									onChange={() => onToggleSelect(item)}
								/>
								<span className="flex-shrink-0 text-faint">
									{isDir ? (
										<FolderIcon size={13} strokeWidth={1.6} />
									) : (
										<FileIcon size={13} strokeWidth={1.6} />
									)}
								</span>
								<span className="min-w-0 flex-1">
									<span
										className={`block truncate ${
											queued
												? "text-faint line-through"
												: isDir
													? "text-default"
													: "text-muted"
										}`}
									>
										{item.name}
									</span>
									{match.within.length > 0 && (
										<span className="block truncate text-[11px] text-faint">
											in {match.within.join(" › ")}
										</span>
									)}
								</span>
								{showDates && (
									<span
										className="flex-shrink-0 text-right text-[11px] text-faint tabular-nums"
										title={new Date(match.modified).toLocaleString()}
									>
										{readableDate(match.modified)}
									</span>
								)}
								<span
									className={`w-[68px] flex-shrink-0 text-right text-[12px] tabular-nums ${
										queued ? "text-faint" : "text-muted"
									}`}
								>
									{readableSize(match.size)}
								</span>
							</RowMenu>
						);
					})}
					{found.truncated && (
						<div className="mt-[6px] py-[8px] text-center text-[11px] text-muted tabular-nums">
							The largest {found.matches.length} of{" "}
							{found.totalCount.toLocaleString()}
						</div>
					)}
				</div>
			)}
		</div>
	);
};
