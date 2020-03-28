import { ipcRenderer } from "electron";
import React from "react";

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

export default (props) => {
	const { sunburst, list, ...shared } = props;

	return (
		<Application screen="fs">
			<section id="fs-display-navbar">
				<button onClick={() => ipcRenderer.send("drivelist-create")}>
					Disks and folders
				</button>
				<button onClick={() => ipcRenderer.send("vfs-navigateTo")}>
					{props.name}
				</button>
				{props.cursor.map((piece, key) => (
					<button
						key={key}
						onClick={() => {
							garden.log(props.cursor.slice(0, key + 1));
							ipcRenderer.send(
								"vfs-navigateTo",
								...props.cursor.slice(0, key + 1),
							);
						}}
					>
						{piece}
					</button>
				))}
			</section>
			<Sunburst files={sunburst.files} {...shared} />
			<List files={list.files} {...shared} />
		</Application>
	);
};
