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
				{path} - {vfs.status}
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
				{drives.flatMap((device) =>
					device.mountpoints.map((mount) =>
						vfsMap.has(mount.path) ? null : (
							<li key={mount.path}>
								{mount.label || `${mount.path} (${device.description})`}
								<button onClick={() => dispatch(createVfs(mount.path))}>
									Scan
								</button>
							</li>
						),
					),
				)}
			</ul>
			<button onClick={Ob.selectDirectory}>Scan directory</button>
		</section>
	);
};
