import * as drivelist from "drivelist";
import { forwardToRenderer, replayActionMain } from "electron-redux";
import * as redux from "redux";
import { applyMiddleware } from "redux";

import { reducer } from "./common";

const store = redux.createStore(reducer, applyMiddleware(forwardToRenderer));
replayActionMain(store);

export * from "./common";
export { store };

drivelist.list().then((drives) => {
	store.dispatch({
		type: "mckayla.observatory.PROPAGATE_DRIVE_LIST",
		payload: { drives },
	});
});

// Hi
store.subscribe(() => {
	console.log(store.getState());
});
