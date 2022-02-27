import React from "react";
import ReactDOM from "react-dom";
import * as Redux from "react-redux";

import { store } from "../store/renderer";
import { App } from "./components/App";
import "./navigation";

ReactDOM.render(
	<Redux.Provider store={store}>
		<App />
	</Redux.Provider>,
	document.querySelector("#root"),
);
