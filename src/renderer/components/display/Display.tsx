import React, { useEffect } from "react";
import { Stylist } from "react-chic";
import { useSelector } from "react-redux";

import { AppState } from "../../../store/renderer";
import { List } from "./List";
import { Navbar } from "./Navbar";
import { Sunburst } from "./Sunburst";

import styles from "./Display.module.scss";

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
	const { cursor, name } = shared;

	// This makes sure that the state kept by List is maintained relative to the
	// directory that the state is for. We don't use this for Sunburst, because that
	// would cause React to destroy/create our canvas element on every navigation.
	const stateKey = cursor.join("/");

	return (
		<Stylist styles={styles}>
			<Navbar cursor={cursor} name={name} />
			<Sunburst files={sunburst.files} {...shared} />
			<List key={stateKey} files={list.files} {...shared} />
		</Stylist>
	);
};
