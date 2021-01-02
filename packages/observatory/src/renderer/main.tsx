import React from "react";
import ReactDOM from "react-dom";
import * as Redux from "react-redux";

import { store } from "../store/renderer";
import { Application } from "./components/Application";

ReactDOM.render(
	<Redux.Provider store={store}>
		<Application />
	</Redux.Provider>,
	document.querySelector("#root"),
);

// This is a bit janky, but it works.
// let inPopState = false;

// If we push before render it looks like we can go back even if we can't
// if (!inPopState)
// 	history.pushState(packet.cursor, packet.name, location.href);
// else inPopState = false;

// window.addEventListener("popstate", (event) => {
// 	garden.log("popstate event.state:", event.state);
// 	inPopState = true;
// 	if (event.state) ipcRenderer.send("vfs-navigateTo", ...event.state);
// });
