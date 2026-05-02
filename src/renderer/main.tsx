import React from "react";
import { createRoot } from "react-dom/client";
import * as Redux from "react-redux";

import { store } from "../store/renderer";
import { Application } from "./components/Application";
import "./navigation";
import "./resources/fonts";

const container = document.querySelector("#root");
if (!container) throw new Error("missing #root element");

createRoot(container).render(
	<Redux.Provider store={store}>
		<Application />
	</Redux.Provider>,
);
