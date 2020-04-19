import React, { ReactNode } from "react";
import * as Redux from "react-redux";

import { store } from "../store/renderer";

type Props =
	| { screen: "loading" }
	| {
			children: ReactNode;
			screen: "menu" | "fs";
	  };

export default (props: Props) => (
	<>
		<div id="titlebar">
			<h1>Observatory</h1>
		</div>
		<div id="application-display" className={props.screen}>
			{props.screen !== "loading" && (
				<Redux.Provider store={store}>{props.children}</Redux.Provider>
			)}
		</div>
	</>
);
