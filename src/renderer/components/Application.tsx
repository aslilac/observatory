import React from "react";
import { useSelector } from "react-redux";

import { AppState } from "../../store/renderer";
import { Display } from "./display/Display";
import { Menu } from "./menu/Menu";

export const Application = () => {
	const vfsState = useSelector((state: AppState) => state.vfs.get(state.inspecting!));

	const viewTree = vfsState?.status === "complete";

	return (
		<div id="application" className={Ob.platform}>
			<div id="titlebar">
				<h1>Observatory</h1>
			</div>
			<div id="application-display" className={viewTree ? "fs" : ""}>
				{viewTree ? <Display /> : <Menu />}
			</div>
		</div>
	);
};
