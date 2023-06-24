import React, { useEffect } from "react";
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

export const Display = () => {
	useEffect(() => {
		Ob.sizeToDisplay();
	}, []);

	const vfsRoot = useSelector((state: AppState) => state.inspecting)!;
	const vfsState = useSelector((state: AppState) => state.vfs.get(vfsRoot));

	if (vfsState?.status !== "complete" || !vfsState.currentTree) {
		return null;
	}

	const { sunburst, list, ...shared } = vfsState.currentTree;

	// This makes sure that the state kept by List is maintained relative to the
	// directory that the state is for. We don't use this for Sunburst, because that
	// would cause React to destroy/create our canvas element on every navigation.
	const stateKey = shared.cursor.join("/");

	return (
		<>
			<section id="fs-display-navbar">
				<button onClick={() => dispatch(showDriveList())}>
					Disks and folders
				</button>
				<button onClick={() => dispatch(navigateToRoot())}>{shared.name}</button>
				{shared.cursor.map((piece, i) => (
					<button
						key={i}
						onClick={() =>
							dispatch(navigateTo(shared.cursor.slice(0, i + 1)))
						}
					>
						{piece}
					</button>
				))}
			</section>
			<Sunburst files={sunburst.files} {...shared} />
			<List key={stateKey} files={list.files} {...shared} />
		</>
	);
};
