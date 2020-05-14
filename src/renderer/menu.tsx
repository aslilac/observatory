import { ipcRenderer, remote } from "electron";
import React from "react";
import { useSelector, useDispatch } from "react-redux";

import { AppState, createVfs, mountVfs } from "../store/renderer";

export default () => {
	const dispatch = useDispatch();
	const drives = useSelector((state: AppState) => state.drives);
	const vfsMap = useSelector((state: AppState) => state.vfs);

	console.log(drives, vfsMap);

	const selectDirectory = async () => {
		const result = await remote.dialog.showOpenDialog({
			properties: ["openDirectory"],
		});

		if (!result.canceled) dispatch(createVfs(result.filePaths[0]));
	};

	const list = [];

	vfsMap.forEach((vfs, path) => {
		list.push(
			<li key={path}>
				{path} - {vfs.status}
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
								{mount.label ||
									`${mount.path} (${device.description})`}
								<button
									onClick={() =>
										dispatch(createVfs(mount.path))
									}
								>
									Scan
								</button>
							</li>
						),
					),
				)}
			</ul>
			<button onClick={selectDirectory}>Scan directory</button>
		</section>
	);
};
