import "@mckayla/electron-redux/preload";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("Ob", {
	platform: process.platform,
	configureWindowHeight,
	selectDirectory,
});

function selectDirectory() {
	ipcRenderer.invoke("mckayla.observatory.SELECT_DIRECTORY");
}

function configureWindowHeight() {
	ipcRenderer.invoke("mckayla.observatory.CONFIGURE_WINDOW_HEIGHT");
}
