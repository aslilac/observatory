import "@mckayla/electron-redux/preload";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("Ob", {
	platform: process.platform,
	selectDirectory,
});

function selectDirectory() {
	ipcRenderer.invoke("mckayla.observatory.SELECT_DIRECTORY");
}
