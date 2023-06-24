import React from "react";
import ReactDOM from "react-dom";
import * as Redux from "react-redux";

import { store } from "../store/renderer";
import { Application } from "./components/Application";
import "./navigation";

ReactDOM.render(
	<Redux.Provider store={store}>
		<Application />
	</Redux.Provider>,
	document.querySelector("#root"),
);
