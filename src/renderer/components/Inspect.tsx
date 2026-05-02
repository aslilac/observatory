import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { CleanupItem } from "../state";
import { readableSize } from "../util";
import { FolderTree } from "./FolderTree";
import { LegendList } from "./LegendList";
import { MultiSelectBar } from "./MultiSelectBar";
import { Sunburst } from "./Sunburst";
import { Segmented, Toolbar } from "./Toolbar";

type SelectableItem = { path: string; name: string; size: number };

type InspectProps = {
	inspecting: string;
	tree: Ob.RenderTree;
	cursor: string[];
	setCursor: (cursor: string[]) => void;
	onShowMenu: () => void;
	canBack: boolean;
	canForward: boolean;
	onBack: () => void;
	onForward: () => void;
	cleanupChip: React.ReactNode;
	onAddToCleanup: (items: Array<Omit<CleanupItem, "addedAt">>) => void;
};

type ViewMode = "list" | "tree";

export const Inspect = ({
	inspecting,
	tree,
	cursor,
	setCursor,
	onShowMenu,
	canBack,
	canForward,
	onBack,
	onForward,
	cleanupChip,
	onAddToCleanup,
}: InspectProps) => {
	const [mode, setMode] = useState<ViewMode>("list");
	const [selection, setSelection] = useState<Map<string, SelectableItem>>(
		() => new Map(),
	);

	const cursorKey = cursor.join("/");

	// Reset selection on any navigation.
	useEffect(() => {
		setSelection(new Map());
	}, [inspecting, cursorKey]);

	const toggleSelect = useCallback((item: SelectableItem) => {
		setSelection((prev) => {
			const next = new Map(prev);
			if (next.has(item.path)) next.delete(item.path);
			else next.set(item.path, item);
			return next;
		});
	}, []);

	const cancelSelect = useCallback(() => setSelection(new Map()), []);

	const addSelectedToCleanup = useCallback(() => {
		const items = Array.from(selection.values()).map((i) => ({
			path: i.path,
			name: i.name,
			size: i.size,
		}));
		onAddToCleanup(items);
		setSelection(new Map());
	}, [selection, onAddToCleanup]);

	const selectionTotal = useMemo(
		() => Array.from(selection.values()).reduce((s, i) => s + i.size, 0),
		[selection],
	);

	const navigateForward = (...into: string[]) =>
		setCursor([...cursor, ...into]);
	const navigateUp = () => setCursor(cursor.slice(0, -1));

	const { sunburst, list, ...shared } = tree;

	return (
		<>
			<Toolbar
				root={tree.name}
				cursor={cursor}
				onShowMenu={onShowMenu}
				onCursor={setCursor}
				canBack={canBack}
				canForward={canForward}
				onBack={onBack}
				onForward={onForward}
				right={
					<Segmented<ViewMode>
						value={mode}
						options={[
							{ value: "list", label: "List" },
							{ value: "tree", label: "Tree" },
						]}
						onChange={setMode}
					/>
				}
				cleanupChip={cleanupChip}
			/>
			<div className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(360px,1fr)] overflow-hidden">
				<Sunburst
					files={sunburst.files}
					capacity={shared.capacity}
					size={shared.size}
					position={shared.position}
					rootSize={shared.rootSize}
					onNavigateUp={navigateUp}
					onNavigateForward={navigateForward}
				/>
				<div className="flex min-h-0 flex-col py-[16px] pr-[18px] pl-[12px]">
					<div className="min-h-0 flex-1 overflow-auto">
						{mode === "list" ? (
							<LegendList
								inspecting={inspecting}
								cursor={cursor}
								name={tree.name}
								size={tree.size}
								capacity={tree.capacity}
								files={list.files}
								selection={selection}
								onForward={navigateForward}
								onToggleSelect={toggleSelect}
							/>
						) : (
							<FolderTree
								inspecting={inspecting}
								cursor={cursor}
								files={sunburst.files}
								selection={selection}
								onForward={navigateForward}
								onToggleSelect={toggleSelect}
							/>
						)}
					</div>
				</div>
			</div>
			{selection.size > 0 ? (
				<MultiSelectBar
					count={selection.size}
					totalSize={selectionTotal}
					onCancel={cancelSelect}
					onAddToCleanup={addSelectedToCleanup}
				/>
			) : (
				<div className="flex h-[28px] items-center border-t border-line-soft px-[14px] font-mono text-[11px] text-muted">
					{readableSize(tree.size)}
					{tree.capacity !== tree.size && (
						<>
							<span className="mx-[6px]">·</span>
							{readableSize(tree.capacity)} capacity
						</>
					)}
				</div>
			)}
		</>
	);
};
