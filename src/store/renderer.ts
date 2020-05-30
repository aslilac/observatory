import { syncRenderer } from "@mckayla/electron-redux";
import * as redux from "redux";

import { reducer } from "./common";

const store = redux.createStore(reducer, syncRenderer);
const { dispatch } = store;

export * from "./common";
export { dispatch, store };
