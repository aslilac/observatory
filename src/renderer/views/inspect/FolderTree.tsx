import React, { useCallback, useEffect, useState } from "react";

import { ChevronRightIcon } from "lucide-react";

import { oklchSwatch } from "#/colors";
import { rowActions } from "#/contextActions";
import { joinPath } from "#/state";
import { readableSize } from "#/util";
import { Checkbox } from "#/components/Checkbox";
import { type ContextMenuItem, RowMenu } from "#/components/ContextMenu";
import {
	type FileListBaseProps,
	type SelectableItem,
	selectableFromFile,
} from "./types";

type CacheValue = Ob.VfsNode[] | "loading" | "error";

type FolderTreeProps = FileListBaseProps & {
	rootName: string;
	onForward: (...names: string[]) => void;
};

export const FolderTree: React.FC<FolderTreeProps> = ({
	inspecting,
	cursor,
	rootName,
	files,
	hueByName,
	selection,
	onForward,
	onToggleSelect,
	onAddToCleanup,
}) => {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
	const [cache, setCache] = useState<Map<string, CacheValue>>(new Map());

	const cursorKey = cursor.join("/");
	useEffect(() => {
		setExpanded(new Set([""]));
		setCache(new Map());
	}, [inspecting, cursorKey]);

	const toggleExpand = useCallback((key: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}, []);

	// Pull in deeper children on demand. The render-tree payload caps
	// recursion at depth 6, and stale dev sessions can sometimes hand us a
	// sparser shape, so anything past what was inlined gets fetched here
	// and cached by row key.
	const requestChildren = useCallback(
		(key: string, subCursor: string[]) => {
			setCache((prev) => {
				if (prev.has(key)) {
					return prev;
				}
				const next = new Map(prev);
				next.set(key, "loading");
				return next;
			});
			void Ob.getRenderTree(inspecting, subCursor).then(
				(result) => {
					const children = result?.tree?.files ?? result?.list.files ?? [];
					setCache((prev) => new Map(prev).set(key, children));
				},
				() => {
					setCache((prev) => new Map(prev).set(key, "error"));
				},
			);
		},
		[inspecting],
	);

	return (
		<div className="text-[13px]">
			<Row
				name={rootName}
				size={files.reduce((sum, f) => sum + f.size, 0)}
				depth={0}
				hue={null}
				expandable={files.length > 0}
				expanded={expanded.has("")}
				selected={false}
				selectable={false}
				onToggleExpand={() => toggleExpand("")}
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
					toggleExpand={toggleExpand}
					cache={cache}
					requestChildren={requestChildren}
					hueByName={hueByName}
					selection={selection}
					onForward={onForward}
					onToggleSelect={onToggleSelect}
					onAddToCleanup={onAddToCleanup}
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
	cache: Map<string, CacheValue>;
	requestChildren: (key: string, subCursor: string[]) => void;
	hueByName: Map<string, number>;
	selection: Map<string, SelectableItem>;
	onForward: (...names: string[]) => void;
	onToggleSelect: (item: SelectableItem) => void;
	onAddToCleanup: (item: SelectableItem) => void;
};

const TreeChildren: React.FC<ChildrenProps> = ({
	inspecting,
	cursor,
	files,
	depth,
	path,
	expanded,
	toggleExpand,
	cache,
	requestChildren,
	hueByName,
	selection,
	onForward,
	onToggleSelect,
	onAddToCleanup,
}) => (
	<>
		{files.map((file) => {
			const key = [...path, file.name].join("/");
			const { fullPath, item } = selectableFromFile(
				file,
				joinPath(inspecting, ...cursor, ...path, file.name),
			);
			const isOpen = expanded.has(key);
			const isDir = file.type === "directory";
			const cached = cache.get(key);
			const cachedChildren = Array.isArray(cached) ? cached : null;
			const childList = cachedChildren ?? (isDir ? file.files : []);
			const isLoading = cached === "loading";
			const isError = cached === "error";
			// Always offer a toggle on directories — we may need to fetch
			// children we don't have inline yet.
			const expandable = isDir;

			const handleToggle = () => {
				toggleExpand(key);
				if (
					isDir &&
					!isOpen &&
					childList.length === 0 &&
					cached === undefined
				) {
					requestChildren(key, [...cursor, ...path, file.name]);
				}
			};

			return (
				<React.Fragment key={key}>
					<Row
						name={file.name}
						size={file.size}
						depth={depth}
						hue={
							depth === 1 && isDir ? (hueByName.get(file.name) ?? null) : null
						}
						expandable={expandable}
						expanded={isOpen}
						selected={selection.has(fullPath)}
						selectable
						onToggleExpand={handleToggle}
						onToggleSelect={() => onToggleSelect(item)}
						onClick={
							isDir
								? () => onForward(...path, file.name)
								: () => onToggleSelect(item)
						}
						items={rowActions({
							path: fullPath,
							name: file.name,
							size: file.size,
							type: isDir ? "directory" : "file",
							onAddToCleanup,
						})}
					/>
					{isOpen && isDir && (
						<>
							{isLoading && (
								<Placeholder depth={depth + 1}>loading…</Placeholder>
							)}
							{isError && (
								<Placeholder depth={depth + 1}>couldn't load</Placeholder>
							)}
							{!isLoading && !isError && childList.length === 0 && (
								<Placeholder depth={depth + 1}>empty</Placeholder>
							)}
							{childList.length > 0 && (
								<TreeChildren
									inspecting={inspecting}
									cursor={cursor}
									files={childList}
									depth={depth + 1}
									path={[...path, file.name]}
									expanded={expanded}
									toggleExpand={toggleExpand}
									cache={cache}
									requestChildren={requestChildren}
									hueByName={hueByName}
									selection={selection}
									onForward={onForward}
									onToggleSelect={onToggleSelect}
									onAddToCleanup={onAddToCleanup}
								/>
							)}
						</>
					)}
				</React.Fragment>
			);
		})}
	</>
);

type PlaceholderProps = {
	depth: number;
	children: React.ReactNode;
};

const Placeholder: React.FC<PlaceholderProps> = ({ depth, children }) => (
	<div className="flex items-center gap-[6px] px-[8px] py-[4px] font-mono text-[11px] text-faint">
		<span style={{ width: depth * 14 }} className="flex-shrink-0" />
		<span className="w-[22px] flex-shrink-0" />
		<span>{children}</span>
	</div>
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
	items?: ContextMenuItem[];
};

const Row: React.FC<RowProps> = ({
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
	items,
}) => {
	const className = `group flex items-center gap-[6px] rounded-[5px] py-[5px] pr-[8px] pl-[8px] ${
		selected ? "bg-fill" : "hover:bg-fill"
	} ${onClick ? "cursor-pointer" : "cursor-default"}`;

	const content = (
		<>
			<span style={{ width: depth * 14 }} className="flex-shrink-0" />
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					if (expandable) {
						onToggleExpand();
					}
				}}
				disabled={!expandable}
				title={expandable ? (expanded ? "Collapse" : "Expand") : undefined}
				className="-mx-[2px] grid h-[22px] w-[22px] flex-shrink-0 cursor-pointer place-items-center rounded-button text-faint hover:bg-fill-strong hover:text-default disabled:cursor-default disabled:opacity-0 disabled:hover:bg-transparent"
			>
				<ChevronRightIcon
					size={9}
					strokeWidth={3}
					className={`transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}
				/>
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
		</>
	);

	if (items) {
		return (
			<RowMenu className={className} onClick={onClick} items={items}>
				{content}
			</RowMenu>
		);
	}

	return (
		<div className={className} onClick={onClick}>
			{content}
		</div>
	);
};
