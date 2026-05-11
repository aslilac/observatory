import React, { useMemo } from "react";

import { FileIcon, FolderIcon } from "lucide-react";

import { oklchSwatch } from "#/colors";
import { rowActions } from "#/contextActions";
import { joinPath } from "#/state";
import { readableDate, readableSize } from "#/util";
import { Checkbox } from "#/components/Checkbox";
import { RowMenu } from "#/components/ContextMenu";
import type { SortMode } from "./SortPicker";
import { type FileListBaseProps, selectableFromFile } from "./types";

const TOP_N = 10;

type LegendListProps = FileListBaseProps & {
	name: string;
	size: number;
	capacity: number;
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
	const free = capacity > size ? capacity - size : 0;

	const sorted = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);

	const collapse = sortMode === "size" && !showAll && sorted.length > TOP_N;
	const visible = collapse ? sorted.slice(0, TOP_N) : sorted;
	const hiddenCount = sorted.length - visible.length;
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
							style={{ background: oklchSwatch(hue) }}
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
								isDir ? "text-default" : "text-muted"
							}`}
						>
							{file.name}
							{isDir && <span className="text-muted">/</span>}
						</span>
						{showDate && (
							<span
								className="w-[88px] flex-shrink-0 text-right font-mono text-[11px] text-faint tabular-nums"
								title={new Date(file.mtime).toLocaleString()}
							>
								{readableDate(file.mtime)}
							</span>
						)}
						<span className="w-[68px] flex-shrink-0 text-right font-mono text-[12px] text-muted tabular-nums">
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
					Show all {sorted.length} items{" "}
					<span className="font-mono text-faint">({hiddenCount} more)</span>
				</button>
			)}

			{free > 0 && (
				<div className="mt-[8px] flex justify-between border-t border-line-soft px-[8px] pt-[10px] pb-[4px] text-[12px] text-muted">
					<span className="flex items-center gap-[8px]">
						<span className="block h-[8px] w-[8px] rounded-full border border-faint" />
						free space
					</span>
					<span className="font-mono">{readableSize(free)}</span>
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
