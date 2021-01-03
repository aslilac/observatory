import "@mckayla/electron-redux/preload";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("Ob", {
	platform: process.platform,
	selectDirectory,
	sizeToDisplay,
	sizeToMenu,
});

function selectDirectory() {
	ipcRenderer.invoke("mckayla.observatory.SELECT_DIRECTORY");
}

function sizeToDisplay() {
	ipcRenderer.invoke("mckayla.observatory.SIZE_TO_DISPLAY");
}

function sizeToMenu() {
	ipcRenderer.invoke("mckayla.observatory.SIZE_TO_MENU");
}
