import { ipcRenderer } from "electron";
import React from "react";
import { useSelector } from "react-redux";

import { AppState } from "../store/renderer";
import Application from "./application";
import List from "./list";
import Sunburst from "./sunburst";

import gardens from "../../gardens.config";
const garden = gardens.scope("renderer");

document.body.className += ` ${process.platform}`;

// const titlebar = document.getElementById("titlebar");
// titlebar.addEventListener("dragover", (drag) => drag.preventDefault());
// titlebar.addEventListener("drop", (drop) => {
// 	const pointer = drop.dataTransfer.getData("filePointer");
// 	console.log("drop:", pointer);
// 	if (pointer) {
// 		drop.preventDefault();
// 		garden.log("deleting", pointer);

// 		const e = document.getElementById(pointer);
// 		garden.log(e);

// 		e.parentElement.removeChild(e);
// 		titlebar.appendChild(e);
// 	}
// });

export default () => {
	const { sunburst, list, ...shared } = useSelector(
		(state: AppState) => state.currentTree,
	);

	return (
		<>
			<section id="fs-display-navbar">
				<button onClick={() => ipcRenderer.send("drivelist-create")}>
					Disks and folders
				</button>
				<button onClick={() => ipcRenderer.send("vfs-navigateTo")}>
					{shared.name}
				</button>
				{shared.cursor.map((piece, key) => (
					<button
						key={key}
						onClick={() => {
							garden.log(shared.cursor.slice(0, key + 1));
							// Way wrong, need to dispatch
							ipcRenderer.send(
								"vfs-navigateTo",
								...shared.cursor.slice(0, key + 1),
							);
						}}
					>
						{piece}
					</button>
				))}
			</section>
			<Sunburst files={sunburst.files} {...shared} />
			<List files={list.files} {...shared} />
		</>
	);
};
