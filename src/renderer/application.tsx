import React from "react";
import { useSelector } from "react-redux";

import { AppState } from "../store/renderer";
import Display from "./display";
import Menu from "./menu";

export default () => {
	const vfsState = useSelector((state: AppState) =>
		state.vfs.get(state.inspecting),
	);

	const viewTree = vfsState?.status === "complete" && vfsState.currentTree;

	return (
		<>
			<div id="titlebar">
				<h1>Observatory</h1>
			</div>
			<div id="application-display" className={viewTree && "fs"}>
				{viewTree ? <Display /> : <Menu />}
			</div>
		</>
	);
};
