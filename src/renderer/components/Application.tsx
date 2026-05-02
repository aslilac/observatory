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
		<div id="application" className={Ob.platform}>
			<div id="titlebar">
				<h1>Observatory</h1>
			</div>
			<div id="application-display" className={viewTree ? "fs" : ""}>
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
