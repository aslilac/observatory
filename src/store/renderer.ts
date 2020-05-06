import { syncRenderer } from "@mckayla/electron-redux";
import * as redux from "redux";

import { reducer } from "./common";

const store = redux.createStore(reducer, syncRenderer);

export * from "./common";
export { store };
