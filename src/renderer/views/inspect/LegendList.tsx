import React, { useMemo } from "react";

import { FileIcon, FolderIcon } from "lucide-react";

import { isDarkTheme, sunburstColor } from "#/colors";
import { rowActions } from "#/contextActions";
import { readableDate, readableSize } from "#/format";
import { joinPath } from "#/paths";
import { useCleanupQueue } from "#/state";
import { Checkbox } from "#/components/Checkbox";
import { RowMenu } from "#/components/ContextMenu";
import type { ReservedGroup } from "./reserved";
import type { SortMode } from "./SortPicker";
import { type FileListBaseProps, selectableFromFile } from "./types";

const TOP_N = 10;

type LegendListProps = FileListBaseProps & {
	name: string;
	size: number;
	capacity: number;
	// What Windows keeps for itself, which isn't in `size`.
	reserved: ReservedGroup[];
	onForward: (name: string) => void;
	sortMode: SortMode;
	showAll: boolean;
	onShowAll: () => void;
};

export const LegendList: React.FC<LegendListProps> = ({
	inspecting,
	cursor,
	name,
	size,
	capacity,
	reserved,
	files,
	hueByName,
	selection,
	onForward,
	onToggleSelect,
	onAddToCleanup,
	sortMode,
	showAll,
	onShowAll,
}) => {
	const taken = size + reserved.reduce((sum, g) => sum + g.size, 0);
	const free = capacity > taken ? capacity - taken : 0;
	const dark = isDarkTheme();
	const { includes: inCleanup } = useCleanupQueue();

	const sorted = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);

	const collapse = sortMode === "size" && !showAll && sorted.length > TOP_N;
	const visible = collapse ? sorted.slice(0, TOP_N) : sorted;
	const showDate = sortMode === "newest" || sortMode === "oldest";

	return (
		<div className="flex flex-col text-[13px]">
			<div className="mb-1 flex justify-between border-b border-line py-[8px] pr-[4px] pl-[4px]">
				<div>
					<div className="text-[14px] font-semibold">{name}</div>
				</div>
				<div className="font-mono text-[13px] text-default">
					{readableSize(size)}
				</div>
			</div>

			{visible.map((file) => {
				const { fullPath, item, isDir } = selectableFromFile(
					file,
					joinPath(inspecting, ...cursor, file.name),
				);
				const isSelected = selection.has(fullPath);
				const queued = inCleanup(fullPath);
				const hue = hueByName.get(file.name) ?? 0;

				return (
					<RowMenu
						key={file.name}
						className={`group flex items-center gap-[8px] rounded-[5px] px-[8px] py-[7px] ${
							isSelected ? "bg-fill" : "hover:bg-fill"
						} ${isDir ? "cursor-pointer" : ""}`}
						onClick={() =>
							isDir ? onForward(file.name) : onToggleSelect(item)
						}
						items={rowActions({
							path: fullPath,
							name: file.name,
							size: file.size,
							type: isDir ? "directory" : "file",
							onAddToCleanup,
						})}
					>
						<Checkbox
							checked={isSelected}
							onChange={() => onToggleSelect(item)}
						/>
						<span
							className="block h-[8px] w-[8px] flex-shrink-0 rounded-full"
							style={{
								background: sunburstColor(hue, cursor.length, file.type, dark),
							}}
						/>
						<span className="flex-shrink-0 text-faint">
							{isDir ? (
								<FolderIcon size={13} strokeWidth={1.6} />
							) : (
								<FileIcon size={13} strokeWidth={1.6} />
							)}
						</span>
						<span
							className={`min-w-0 flex-1 truncate ${
								queued
									? "text-faint line-through"
									: isDir
										? "text-default"
										: "text-muted"
							}`}
						>
							{file.name}
							{isDir && (
								<span className={queued ? undefined : "text-muted"}>/</span>
							)}
						</span>
						{showDate && (
							<span
								className="w-[88px] flex-shrink-0 text-right font-mono text-[11px] text-faint tabular-nums"
								title={new Date(file.mtime).toLocaleString()}
							>
								{readableDate(file.mtime)}
							</span>
						)}
						<span
							className={`w-[68px] flex-shrink-0 text-right font-mono text-[12px] tabular-nums ${
								queued ? "text-faint" : "text-muted"
							}`}
						>
							{readableSize(file.size)}
						</span>
					</RowMenu>
				);
			})}

			{collapse && (
				<button
					type="button"
					onClick={onShowAll}
					className="mt-[6px] cursor-pointer rounded-[5px] px-[8px] py-[7px] text-left text-[12px] text-muted hover:bg-fill hover:text-default"
				>
					Show all {sorted.length} items
				</button>
			)}

			{(reserved.length > 0 || free > 0) && (
				<div className="mt-[8px] flex flex-col gap-[8px] border-t border-line-soft px-[8px] pt-[10px] pb-[4px] text-[12px] text-muted">
					{reserved.map((group) => (
						<div
							key={group.kind}
							className="flex justify-between"
							title={`${group.names.join(", ")}\n${group.hint}`}
						>
							<span className="flex items-center gap-[8px]">
								<span
									className="block h-[8px] w-[8px] rounded-full"
									style={{
										background: sunburstColor(0, 0, "reserved", dark),
									}}
								/>
								{group.label}
							</span>
							<span className="font-mono">{readableSize(group.size)}</span>
						</div>
					))}
					{free > 0 && (
						<div className="flex justify-between">
							<span className="flex items-center gap-[8px]">
								<span className="block h-[8px] w-[8px] rounded-full border border-faint" />
								free space
							</span>
							<span className="font-mono">{readableSize(free)}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
};

function sortFiles(files: Ob.VfsNode[], mode: SortMode): Ob.VfsNode[] {
	switch (mode) {
		case "size":
			// Already in size-desc order from the backend.
			return files;
		case "name":
			return files.toSorted((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			);
		case "newest":
			return files.toSorted((a, b) => b.mtime - a.mtime);
		case "oldest":
			return files.toSorted((a, b) => a.mtime - b.mtime);
	}
}
