import React, { useMemo } from "react";

import { oklchSwatch } from "#/colors";
import { rowActions } from "#/contextActions";
import { joinPath } from "#/state";
import { readableDate, readableSize } from "#/util";
import { useContextMenu } from "#/components/ContextMenu";
import type { SortMode } from "./SortPicker";

type SelectableItem = { path: string; name: string; size: number };

const TOP_N = 10;

type LegendListProps = {
	inspecting: string;
	cursor: string[];
	name: string;
	size: number;
	capacity: number;
	files: Ob.VfsNode[];
	hueByName: Map<string, number>;
	selection: Map<string, SelectableItem>;
	onForward: (name: string) => void;
	onToggleSelect: (item: SelectableItem) => void;
	onAddToCleanup: (item: SelectableItem) => void;
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
	const menu = useContextMenu();

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
				const fullPath = joinPath(inspecting, ...cursor, file.name);
				const item: SelectableItem = {
					path: fullPath,
					name: file.name,
					size: file.size,
				};
				const isSelected = selection.has(fullPath);
				const isDir = file.type === "directory";
				const hue = hueByName.get(file.name) ?? 0;

				return (
					<div
						key={file.name}
						className={`group flex items-center gap-[8px] rounded-[5px] px-[8px] py-[7px] ${
							isSelected ? "bg-fill" : "hover:bg-fill"
						} ${isDir ? "cursor-pointer" : ""}`}
						onClick={() =>
							isDir ? onForward(file.name) : onToggleSelect(item)
						}
						onContextMenu={(e) =>
							menu.open(
								e,
								rowActions({
									path: fullPath,
									name: file.name,
									size: file.size,
									type: isDir ? "directory" : "file",
									onAddToCleanup,
								}),
							)
						}
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
							{isDir ? <FolderIcon /> : <FileIcon />}
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
					</div>
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
			{menu.render}
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

const FolderIcon: React.FC = () => (
	<svg
		width="13"
		height="13"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.6"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
	</svg>
);

const FileIcon: React.FC = () => (
	<svg
		width="13"
		height="13"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.6"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
		<path d="M14 3v6h6" />
	</svg>
);

type CheckboxProps = {
	checked: boolean;
	onChange: () => void;
};

const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange }) => (
	<span
		role="checkbox"
		aria-checked={checked}
		onClick={(e) => {
			e.stopPropagation();
			onChange();
		}}
		className={`flex h-[14px] w-[14px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] border transition-opacity ${
			checked
				? "border-default bg-default text-background opacity-100"
				: "border-line bg-background opacity-0 group-hover:opacity-100"
		}`}
	>
		{checked && (
			<svg width="9" height="9" viewBox="0 0 12 12" fill="none">
				<path
					d="M2 6.5 L5 9 L10 3.5"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		)}
	</span>
);
