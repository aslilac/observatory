import React from "react";
import { useSelector } from "react-redux";

import { AppState } from "../store/renderer";
import Display from "./display";
import Menu from "./menu";

export default () => {
	const tree = useSelector((state: AppState) => state.currentTree);

	return (
		<>
			<div id="titlebar">
				<h1>Observatory</h1>
			</div>
			<div id="application-display" className={tree && "fs"}>
				{tree ? <Display /> : <Menu />}
			</div>
		</>
	);
};
