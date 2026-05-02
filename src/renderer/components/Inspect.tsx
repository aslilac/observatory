import React, { useEffect, useState } from "react";

import { readableSize } from "../util";
import { FolderTree } from "./FolderTree";
import { LegendList } from "./LegendList";
import { Sunburst } from "./Sunburst";
import { Segmented, Toolbar } from "./Toolbar";

type InspectProps = {
	tree: Ob.RenderTree;
	cursor: string[];
	setCursor: (cursor: string[]) => void;
	onShowMenu: () => void;
};

type ViewMode = "list" | "tree";

export const Inspect = ({
	tree,
	cursor,
	setCursor,
	onShowMenu,
}: InspectProps) => {
	const [mode, setMode] = useState<ViewMode>("list");
	useEffect(() => {
		void Ob.sizeToDisplay();
	}, []);

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
								name={tree.name}
								size={tree.size}
								capacity={tree.capacity}
								files={list.files}
								onForward={navigateForward}
							/>
						) : (
							<FolderTree files={sunburst.files} onForward={navigateForward} />
						)}
					</div>
				</div>
			</div>
			<div className="flex h-[28px] items-center border-t border-line-soft px-[14px] font-mono text-[11px] text-muted">
				{readableSize(tree.size)}
				{tree.capacity !== tree.size && (
					<>
						<span className="mx-[6px]">·</span>
						{readableSize(tree.capacity)} capacity
					</>
				)}
			</div>
		</>
	);
};
