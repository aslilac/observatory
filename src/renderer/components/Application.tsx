import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Display } from "./display/Display";
import { Menu } from "./menu/Menu";
import { useDrives, useRenderTree, useScans } from "../state";

export const Application = () => {
	const drives = useDrives();
	const scans = useScans();
	const [inspecting, setInspecting] = useState<string | null>(null);
	const [cursor, setCursor] = useState<string[]>([]);

	useEffect(() => Ob.onSetInspecting(setInspecting), []);

	// Reset cursor whenever the inspected scan changes.
	useEffect(() => {
		setCursor([]);
	}, [inspecting]);

	const inspectingScan = useMemo(
		() =>
			inspecting ? (scans.find((s) => s.path === inspecting) ?? null) : null,
		[inspecting, scans],
	);

	const tree = useRenderTree(
		inspecting,
		cursor,
		inspectingScan?.status ?? null,
	);

	const showDriveList = useCallback(() => setInspecting(null), []);

	const viewTree = inspectingScan?.status === "complete" && tree;

	return (
		<div
			id="application"
			className={`grid h-screen [grid-template-rows:auto_1fr] [grid-template-areas:'titlebar'_'display'] ${Ob.platform}`}
		>
			<div
				id="titlebar"
				className="hidden h-0 [grid-area:titlebar] transition-[background-color,color,height] duration-300 darwin:block darwin:h-[37px] darwin:bg-titlebar darwin:text-center darwin:text-white darwin:z-100 darwin:[-webkit-app-region:drag] darwin:[box-shadow:0_0_15px_#252525]"
			>
				<h1 className="m-0 p-[0.4em] text-[17px] font-extralight">
					Observatory
				</h1>
			</div>
			<div
				id="application-display"
				className={
					viewTree
						? "grid overflow-hidden [grid-area:display] [grid-template-areas:'navbar_list'_'sunburst_list'] [grid-template-columns:1fr_minmax(3.8in,1fr)] [grid-template-rows:1px_1fr]"
						: "grid [grid-area:display]"
				}
			>
				{viewTree ? (
					<Display
						tree={tree}
						cursor={cursor}
						setCursor={setCursor}
						onShowMenu={showDriveList}
					/>
				) : (
					<Menu
						drives={drives}
						scans={scans}
						onInspect={setInspecting}
						onScan={(path) => void Ob.scanPath(path)}
					/>
				)}
			</div>
		</div>
	);
};
