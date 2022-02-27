import React from "react";
import { chic, Stylist } from "react-chic";
import { useSelector } from "react-redux";

import { AppState } from "../../store/renderer";
import { Display } from "./display/Display";
import { Menu } from "./menu/Menu";

import styles from "./App.module.scss";

export const App = () => {
	const vfsState = useSelector((state: AppState) => state.vfs.get(state.inspecting!));

	const viewTree = vfsState?.status === "complete";

	return (
		<Stylist styles={styles}>
			<chic.div cx={["application", Ob.platform]}>
				<chic.div cx="titlebar">
					<h1>Observatory</h1>
				</chic.div>
				<chic.div cx={["application-display", viewTree ? "fs" : ""]}>
					{viewTree ? <Display /> : <Menu />}
				</chic.div>
			</chic.div>
		</Stylist>
	);
};
