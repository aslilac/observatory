import {
	forwardToMain,
	replayActionRenderer,
	getInitialStateRenderer,
} from "electron-redux";
import * as redux from "redux";
import { applyMiddleware } from "redux";

import { reducer } from "./common";

const store = redux.createStore(
	reducer,
	getInitialStateRenderer(),
	applyMiddleware(forwardToMain),
);
replayActionRenderer(store);

export * from "./common";
export { store };

// Hi

store.subscribe(() => {
	console.log(store.getState());
});

(window as any).store = store;
