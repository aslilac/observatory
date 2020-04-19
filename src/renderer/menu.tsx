import { ipcRenderer, remote } from "electron";
import React from "react";
import ReactDOM from "react-dom";
import { useSelector, useDispatch } from "react-redux";

import { AppState, createVfs } from "../store/renderer";
import Application from "./application";

function startScan(path: string) {
	ReactDOM.render(
		<Application screen="loading" />,
		document.querySelector("#application"),
	);

	ipcRenderer.send("vfs-create", path);
}

// Janky hack because I don't want a tsconfig.json and I'm an asshole
declare global {
	interface Array<T> {
		flatMap: (iterator: (item: T, index: number) => any[]) => any[];
	}
}

export default () => {
	const dispatch = useDispatch();
	const list = useSelector((state: AppState) => state.drives);

	const selectDrive = (path: string) => () => dispatch(createVfs(path));
	const selectDirectory = async () => {
		const result = await remote.dialog.showOpenDialog({
			properties: ["openDirectory"],
		});

		if (!result.canceled) dispatch(createVfs(result.filePaths[0]));
	};

	return (
		<section>
			<ul id="menu-drivelist">
				{list.flatMap((device) =>
					device.mountpoints.map((mount) => (
						<li key={mount.path}>
							{mount.label ||
								`${mount.path} (${device.description})`}
							<button onClick={selectDrive(mount.path)}>
								Scan
							</button>
						</li>
					)),
				)}
			</ul>
			<button onClick={selectDirectory}>Scan directory</button>
		</section>
	);
};
