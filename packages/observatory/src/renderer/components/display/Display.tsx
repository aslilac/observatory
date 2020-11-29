import React from "react";
import { useSelector } from "react-redux";

import {
	AppState,
	dispatch,
	navigateTo,
	navigateToRoot,
	showDriveList,
} from "../../../store/renderer";
import { List } from "./List";
import { Sunburst } from "./Sunburst";

document.body.className += ` ${process.platform}`;

export const Display = () => {
	// TODO: Handle undefined vfsState
	const vfsState = useSelector((state: AppState) =>
		state.vfs.get(state.inspecting!),
	)!;

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
