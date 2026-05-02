import React from "react";

import { hueFor, oklchSwatch } from "../colors";
import { joinPath } from "../state";
import { readableSize } from "../util";

type SelectableItem = { path: string; name: string; size: number };

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
}: LegendListProps) => {
	const free = capacity > size ? capacity - size : 0;

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

			{files.map((file, i) => {
				const fullPath = joinPath(inspecting, ...cursor, file.name);
				const item: SelectableItem = {
					path: fullPath,
					name: file.name,
					size: file.size,
				};
				const isSelected = selection.has(fullPath);
				const isDir = file.type === "directory";

				return (
					<div
						key={`${file.name}-${i}`}
						className={`group flex items-center justify-between rounded-[5px] px-[8px] py-[7px] ${
							isSelected
								? "bg-fill"
								: "hover:bg-fill"
						} ${isDir ? "cursor-pointer" : ""}`}
						onClick={() =>
							isDir ? onForward(file.name) : onToggleSelect(item)
						}
					>
						<span className="flex min-w-0 items-center gap-[8px]">
							<Checkbox
								checked={isSelected}
								onChange={() => onToggleSelect(item)}
							/>
							<span
								className="block h-[8px] w-[8px] flex-shrink-0 rounded-full"
								style={{ background: oklchSwatch(hueFor(i)) }}
							/>
							<span className="truncate">{file.name}</span>
						</span>
						<span className="ml-[12px] flex-shrink-0 font-mono text-[12px] text-muted">
							{readableSize(file.size)}
						</span>
					</div>
				);
			})}

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
