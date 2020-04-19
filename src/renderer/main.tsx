import { ipcRenderer } from "electron";
import React from "react";
import ReactDOM from "react-dom";

import Application from "./application";
import Display from "./display";
import Menu from "./menu";

import gardens from "../../gardens.config";
const garden = gardens.scope("ipc", "renderer");

import { store } from "../store/renderer";

// This is a bit janky, but it works.
let inPopState = false;

ipcRenderer.on("vfs-render", (event, packet) => {
	garden.log("vfs-render packet:", packet);

	ReactDOM.render(
		<Display {...packet} />,
		document.querySelector("#application"),
	);

	// If we push before render it looks like we can go back even if we can't
	if (!inPopState)
		history.pushState(packet.cursor, packet.name, location.href);
	else inPopState = false;
});

store.subscribe(() => {
	const { currentTree } = store.getState();

	if (currentTree) {
		ReactDOM.render(
			<Display {...currentTree} />,
			document.querySelector("#application"),
		);
	}
});

window.addEventListener("popstate", (event) => {
	garden.log("popstate event.state:", event.state);
	inPopState = true;
	if (event.state) ipcRenderer.send("vfs-navigateTo", ...event.state);
});
