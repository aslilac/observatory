import React from "react";
import { useSelector } from "react-redux";

import { AppState, createVfs, dispatch, inspectVfs } from "../../../store/renderer";

export const Menu = () => {
	const drives = useSelector((state: AppState) => state.drives);
	const vfsMap = useSelector((state: AppState) => state.vfs);

	const list: JSX.Element[] = [];

	vfsMap.forEach((vfs, path) => {
		list.push(
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
	});

	return (
		<section>
			<ul id="menu-drivelist">
				{list}
				{Array.from(drives.values()).map((drive) =>
					// Don't show the drive in this list if it's shown in the list of scans
					vfsMap.has(drive.mountPath) ? null : (
						<li key={drive.mountPath}>
							{drive.description}
							<button onClick={() => dispatch(createVfs(drive.mountPath))}>
								Scan
							</button>
						</li>
					),
				)}
			</ul>
			<button onClick={Ob.selectDirectory}>Scan directory</button>
		</section>
	);
};
