import { BrowserWindow } from "electron";

export const init = (view: BrowserWindow) => {
	view.on("app-command", (event, command) => {
		// Navigate the window back when the user hits their mouse back button
		if (command === "browser-backward" && view.webContents.canGoBack()) {
			view.webContents.goBack();
		} else if (
			command === "browser-forward" &&
			view.webContents.canGoForward()
		) {
			view.webContents.goForward();
		}
	});

	view.on("swipe", (event, direction) => {
		// Navigate the window back when the users swipe
		if (direction === "left" && view.webContents.canGoBack()) {
			view.webContents.goBack();
		} else if (direction === "right" && view.webContents.canGoForward()) {
			view.webContents.goForward();
		}
	});

	// TODO This seems deprecated?
	// XXX: wth is going on here, clean this up plz
	// view.on("will-navigate", (event) => {
	// 	event.preventDefault();
	// });

	view.on("enter-full-screen", () => {});

	view.on("leave-full-screen", () => {});
};

export default { init };
