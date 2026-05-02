import React, { useState } from "react";

import { hueFor, oklchSwatch } from "../colors";
import { joinPath } from "../state";
import { readableSize } from "../util";

type SelectableItem = { path: string; name: string; size: number };

type FolderTreeProps = {
	inspecting: string;
	cursor: string[];
	files: Ob.VfsNode[];
	selection: Map<string, SelectableItem>;
	onForward: (...names: string[]) => void;
	onToggleSelect: (item: SelectableItem) => void;
};

export const FolderTree = ({
	inspecting,
	cursor,
	files,
	selection,
	onForward,
	onToggleSelect,
}: FolderTreeProps) => {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
	const toggle = (key: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	return (
		<div className="text-[13px]">
			<Row
				name="/"
				size={files.reduce((sum, f) => sum + f.size, 0)}
				depth={0}
				hue={null}
				expandable={files.length > 0}
				expanded={expanded.has("")}
				selected={false}
				selectable={false}
				onToggleExpand={() => toggle("")}
				onToggleSelect={undefined}
				onClick={undefined}
			/>
			{expanded.has("") && (
				<TreeChildren
					inspecting={inspecting}
					cursor={cursor}
					files={files}
					depth={1}
					path={[]}
					expanded={expanded}
					toggleExpand={toggle}
					selection={selection}
					onForward={onForward}
					onToggleSelect={onToggleSelect}
				/>
			)}
		</div>
	);
};

type ChildrenProps = {
	inspecting: string;
	cursor: string[];
	files: Ob.VfsNode[];
	depth: number;
	path: string[];
	expanded: Set<string>;
	toggleExpand: (key: string) => void;
	selection: Map<string, SelectableItem>;
	onForward: (...names: string[]) => void;
	onToggleSelect: (item: SelectableItem) => void;
};

const TreeChildren = ({
	inspecting,
	cursor,
	files,
	depth,
	path,
	expanded,
	toggleExpand,
	selection,
	onForward,
	onToggleSelect,
}: ChildrenProps) => (
	<>
		{files.map((file, i) => {
			const key = [...path, file.name].join("/");
			const fullPath = joinPath(inspecting, ...cursor, ...path, file.name);
			const item: SelectableItem = {
				path: fullPath,
				name: file.name,
				size: file.size,
			};
			const isOpen = expanded.has(key);
			const isDir = file.type === "directory";
			const hasChildren = isDir && file.files.length > 0;
			return (
				<React.Fragment key={key}>
					<Row
						name={file.name}
						size={file.size}
						depth={depth}
						hue={depth === 1 && isDir ? hueFor(i) : null}
						expandable={hasChildren}
						expanded={isOpen}
						selected={selection.has(fullPath)}
						selectable
						onToggleExpand={() => toggleExpand(key)}
						onToggleSelect={() => onToggleSelect(item)}
						onClick={
							isDir
								? () => onForward(...path, file.name)
								: () => onToggleSelect(item)
						}
					/>
					{isOpen && hasChildren && (
						<TreeChildren
							inspecting={inspecting}
							cursor={cursor}
							files={file.files}
							depth={depth + 1}
							path={[...path, file.name]}
							expanded={expanded}
							toggleExpand={toggleExpand}
							selection={selection}
							onForward={onForward}
							onToggleSelect={onToggleSelect}
						/>
					)}
				</React.Fragment>
			);
		})}
	</>
);

type RowProps = {
	name: string;
	size: number;
	depth: number;
	hue: number | null;
	expandable: boolean;
	expanded: boolean;
	selected: boolean;
	selectable: boolean;
	onToggleExpand: () => void;
	onToggleSelect: (() => void) | undefined;
	onClick: (() => void) | undefined;
};

const Row = ({
	name,
	size,
	depth,
	hue,
	expandable,
	expanded,
	selected,
	selectable,
	onToggleExpand,
	onToggleSelect,
	onClick,
}: RowProps) => (
	<div
		className={`group flex items-center gap-[6px] rounded-[5px] py-[5px] pr-[8px] pl-[8px] ${
			selected ? "bg-fill" : "hover:bg-fill"
		} ${onClick ? "cursor-pointer" : "cursor-default"}`}
		onClick={onClick}
	>
		<span style={{ width: depth * 14 }} className="flex-shrink-0" />
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				if (expandable) onToggleExpand();
			}}
			disabled={!expandable}
			title={expandable ? (expanded ? "Collapse" : "Expand") : undefined}
			className="-mx-[2px] grid h-[22px] w-[22px] flex-shrink-0 cursor-pointer place-items-center rounded-button text-[12px] text-faint hover:bg-fill-strong hover:text-ink disabled:cursor-default disabled:opacity-0 disabled:hover:bg-transparent"
		>
			{expanded ? "▾" : "▸"}
		</button>
		{selectable && onToggleSelect ? (
			<Checkbox checked={selected} onChange={onToggleSelect} />
		) : (
			<span className="block h-[14px] w-[14px] flex-shrink-0" />
		)}
		{hue !== null ? (
			<span
				className="block h-[8px] w-[8px] flex-shrink-0 rounded-full"
				style={{ background: oklchSwatch(hue) }}
			/>
		) : (
			<span className="block h-[8px] w-[8px] flex-shrink-0" />
		)}
		<span className="flex-1 truncate">{name}</span>
		<span className="font-mono text-[12px] text-muted">
			{readableSize(size)}
		</span>
	</div>
);

const Checkbox = ({
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: () => void;
}) => (
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
