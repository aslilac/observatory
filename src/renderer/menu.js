import { ipcRenderer, remote } from "electron";
import React from "react";
import ReactDOM from "react-dom";

import Application from "./application";

function startScan(path) {
	ReactDOM.render(
		<Application screen="loading" />,
		document.querySelector("#application"),
	);

	ipcRenderer.send("vfs-create", path);
}

export default function Menu({ list }) {
	return (
		<section>
			<ul id="menu-drivelist">
				{list.flatMap((device, dIndex) =>
					device.mountpoints.map((mount, mIndex) => (
						<li key={`${dIndex}-${mIndex}`}>
							{mount.label ||
								`${mount.path} (${device.description})`}
							<button
								onClick={() => {
									startScan(mount.path);
								}}
							>
								Scan
							</button>
						</li>
					)),
				)}
			</ul>
			<button
				onClick={() => {
					remote.dialog.showOpenDialog(
						{
							properties: ["openDirectory"],
						},
						folders => {
							if (folders) {
								startScan(folders[0]);
							}
						},
					);
				}}
			>
				Scan directory
			</button>
			<button onClick={() => startScan("/Library/src")}>
				Jest feckin do et
			</button>
		</section>
	);
}
