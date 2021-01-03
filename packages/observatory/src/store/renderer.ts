import { syncRenderer } from "@mckayla/electron-redux/renderer";
import * as redux from "redux";

import { reducer } from "./common";

const store = redux.createStore(reducer, syncRenderer);
const { dispatch, subscribe } = store;

export * from "./common";
export { dispatch, store, subscribe };
