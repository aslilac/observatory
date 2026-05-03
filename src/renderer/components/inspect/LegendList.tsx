import React, { useMemo } from "react";

import { hueFor, oklchSwatch } from "../../colors";
import { joinPath } from "../../state";
import { readableDate, readableSize } from "../../util";
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
	selection: Map<string, SelectableItem>;
	onForward: (name: string) => void;
	onToggleSelect: (item: SelectableItem) => void;
	sortMode: SortMode;
	showAll: boolean;
	onShowAll: () => void;
};

export const LegendList = ({
	inspecting,
	cursor,
	name,
	size,
	capacity,
	files,
	selection,
	onForward,
	onToggleSelect,
	sortMode,
	showAll,
	onShowAll,
}: LegendListProps) => {
	const free = capacity > size ? capacity - size : 0;

	// `files` arrives sorted by size descending from the VFS, which is also
	// the order the sunburst draws its top-level slices. Lock each item's
	// dot color to that order so re-sorting the list doesn't shuffle the
	// palette away from the wedges.
	const hueByName = useMemo(() => {
		const map = new Map<string, number>();
		files.forEach((f, i) => map.set(f.name, hueFor(i)));
		return map;
	}, [files]);

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
				<div className="font-mono text-[13px] text-ink">
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
				const hue = hueByName.get(file.name) ?? hueFor(0);

				return (
					<div
						key={file.name}
						className={`group flex items-center gap-[8px] rounded-[5px] px-[8px] py-[7px] ${
							isSelected ? "bg-fill" : "hover:bg-fill"
						} ${isDir ? "cursor-pointer" : ""}`}
						onClick={() =>
							isDir ? onForward(file.name) : onToggleSelect(item)
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
								isDir ? "font-medium text-ink" : "text-muted"
							}`}
						>
							{file.name}
							{isDir && <span className="text-faint">/</span>}
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
					className="mt-[6px] cursor-pointer rounded-[5px] px-[8px] py-[7px] text-left text-[12px] text-muted hover:bg-fill hover:text-ink"
				>
					Show all {sorted.length} items{" "}
					<span className="font-mono text-faint">
						({hiddenCount} more)
					</span>
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
	const next = files.slice();
	switch (mode) {
		case "size":
			// Already in size-desc order from the backend, but slice() preserves
			// it so this branch is a no-op aside from returning a fresh array.
			return next;
		case "name":
			return next.sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			);
		case "newest":
			return next.sort((a, b) => b.mtime - a.mtime);
		case "oldest":
			return next.sort((a, b) => a.mtime - b.mtime);
	}
}

const FolderIcon = () => (
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

const FileIcon = () => (
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

const Checkbox = ({ checked, onChange }: CheckboxProps) => (
	<span
		role="checkbox"
		aria-checked={checked}
		onClick={(e) => {
			e.stopPropagation();
			onChange();
		}}
		className={`flex h-[14px] w-[14px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] border transition-opacity ${
			checked
				? "border-ink bg-ink text-paper opacity-100"
				: "border-line bg-paper opacity-0 group-hover:opacity-100"
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
