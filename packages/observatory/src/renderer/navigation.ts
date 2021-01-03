import {
	dispatch,
	inspectVfsAtCursor,
	showDriveList,
	store,
	subscribe,
} from "../store/renderer";

type HistoryState = {
	cursor?: string[];
	inspecting: string | null;
};

let inPopState = false;

window.addEventListener("popstate", (event) => {
	const nextState: HistoryState = event.state;

	console.log(nextState.inspecting, nextState.cursor?.join("/"), "(popping)");

	inPopState = true;

	if (!nextState.inspecting) {
		dispatch(showDriveList());
		return;
	}

	dispatch(inspectVfsAtCursor(nextState.inspecting, nextState.cursor!));
});

function isStateDifferent(current: HistoryState, next: HistoryState) {
	if (current.inspecting !== next.inspecting) {
		console.log("inspecting is different");
		return true;
	}

	if (current.inspecting && !current.cursor) {
		return true;
	}

	if ((current.cursor == null) !== (next.cursor == null)) {
		return true;
	}

	if (Array.isArray(current.cursor) && Array.isArray(next.cursor)) {
		return (
			current.cursor.length !== next.cursor.length ||
			current.cursor.some((item, i) => item !== next.cursor![i])
		);
	}

	return false;
}

subscribe(() => {
	if (inPopState) {
		// console.log("skipping pop state and resetting");
		inPopState = false;
		return;
	}

	// console.log("subscribed");
	// console.log("  current", history.state);

	const reduxState = store.getState();
	const nextState: HistoryState = {
		cursor: reduxState.vfs.get(reduxState.inspecting!)?.cursor,
		inspecting: reduxState.inspecting,
	};

	// console.log("  next   ", nextState);

	// We don't want to have the initial state of "null" on our stack
	if (!history.state) {
		// console.log("  REPLACE");
		console.log(nextState.inspecting, nextState.cursor?.join("/"), "(replace)");
		history.replaceState(nextState, "Observatory");
		return;
	}

	if (isStateDifferent(history.state, nextState)) {
		// console.log("  PUSH");
		console.log(nextState.inspecting, nextState.cursor?.join("/"), "(push)");
		history.pushState(nextState, "Observatory");
		return;
	}

	// console.log("no change");
});
