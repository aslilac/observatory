import React from "react";
import { useDispatch, useSelector } from "react-redux";

import {
	AppState,
	showDriveList,
	navigateTo,
	navigateToRoot,
} from "../store/renderer";
import List from "./list";
import Sunburst from "./sunburst";

import gardens, { vfs } from "../../gardens.config";
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
	const dispatch = useDispatch();
	const vfsState = useSelector((state: AppState) =>
		state.vfs.get(state.inspecting),
	);

	if (vfsState.status !== "complete" || !vfsState.currentTree) {
		return null;
	}

	const { sunburst, list, ...shared } = vfsState.currentTree;

	return (
		<>
			<section id="fs-display-navbar">
				<button onClick={() => dispatch(showDriveList())}>
					Disks and folders
				</button>
				<button onClick={() => dispatch(navigateToRoot())}>
					{shared.name}
				</button>
				{shared.cursor.map((piece, key) => (
					<button
						key={key}
						onClick={() =>
							dispatch(
								navigateTo(shared.cursor.slice(0, key + 1)),
							)
						}
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
