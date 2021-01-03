import React, { useEffect } from "react";
import { useSelector } from "react-redux";

import { AppState, createVfs, dispatch, inspectVfs } from "../../../store/renderer";

export const Menu = () => {
	const drives = useSelector((state: AppState) => state.drives);
	const vfsMap = useSelector((state: AppState) => state.vfs);

	useEffect(() => {
		Ob.sizeToMenu();
	}, [drives, vfsMap]);

	const directoryList: JSX.Element[] = [];

	vfsMap.forEach((vfs, path) => {
		if (!drives.has(path)) {
			directoryList.push(
				<li key={path}>
					{drives.get(path)?.description || path} - {vfs.status}
					<button
						onClick={() => dispatch(inspectVfs(path))}
						disabled={vfs.status !== "complete"}
					>
						View
					</button>
				</li>,
			);
		}
	});

	return (
		<section>
			<ul id="menu-drivelist">
				{Array.from(drives.values()).map((drive) => (
					// Don't show the drive in this list if it's shown in the list of scans

					<li key={drive.mountPath}>
						{drive.description} -{" "}
						{vfsMap.get(drive.mountPath)?.status ?? "not scanned"}
						{vfsMap.has(drive.mountPath) ? (
							<button
								onClick={() => dispatch(inspectVfs(drive.mountPath))}
								disabled={
									vfsMap.get(drive.mountPath)!.status !== "complete"
								}
							>
								View
							</button>
						) : (
							<button onClick={() => dispatch(createVfs(drive.mountPath))}>
								Scan
							</button>
						)}
					</li>
				))}
				{directoryList}
			</ul>
			<button onClick={Ob.selectDirectory}>Scan directory</button>
		</section>
	);
};
