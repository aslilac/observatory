import React, { useState } from "react";

import { hueFor, oklchSwatch } from "../colors";
import { readableSize } from "../util";

type FolderTreeProps = {
	files: Ob.VfsNode[];
	onForward: (...names: string[]) => void;
};

export const FolderTree = ({ files, onForward }: FolderTreeProps) => {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
	const toggle = (key: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};
	return (
		<div className="text-[13px]">
			<Row
				name="/"
				size={files.reduce((sum, f) => sum + f.size, 0)}
				depth={0}
				hue={null}
				expandable={files.length > 0}
				expanded={expanded.has("")}
				onToggle={() => toggle("")}
				onClick={() => undefined}
			/>
			{expanded.has("") && (
				<TreeChildren
					files={files}
					depth={1}
					path={[]}
					expanded={expanded}
					toggle={toggle}
					onForward={onForward}
				/>
			)}
		</div>
	);
};

type ChildrenProps = {
	files: Ob.VfsNode[];
	depth: number;
	path: string[];
	expanded: Set<string>;
	toggle: (key: string) => void;
	onForward: (...names: string[]) => void;
};

const TreeChildren = ({
	files,
	depth,
	path,
	expanded,
	toggle,
	onForward,
}: ChildrenProps) => (
	<>
		{files.map((file, i) => {
			const key = [...path, file.name].join("/");
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
						onToggle={() => toggle(key)}
						onClick={isDir ? () => onForward(...path, file.name) : undefined}
					/>
					{isOpen && hasChildren && (
						<TreeChildren
							files={file.files}
							depth={depth + 1}
							path={[...path, file.name]}
							expanded={expanded}
							toggle={toggle}
							onForward={onForward}
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
	onToggle: () => void;
	onClick: (() => void) | undefined;
};

const Row = ({
	name,
	size,
	depth,
	hue,
	expandable,
	expanded,
	onToggle,
	onClick,
}: RowProps) => (
	<div
		className={`flex items-center gap-[6px] rounded-[5px] py-[5px] pr-[8px] pl-[8px] hover:bg-fill ${
			onClick ? "cursor-pointer" : "cursor-default"
		}`}
		onClick={onClick}
	>
		<span style={{ width: depth * 14 }} className="flex-shrink-0" />
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				if (expandable) onToggle();
			}}
			disabled={!expandable}
			className="w-[14px] flex-shrink-0 cursor-pointer text-[10px] text-faint disabled:cursor-default disabled:opacity-0"
		>
			{expanded ? "▾" : "▸"}
		</button>
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
