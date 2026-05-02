import { contextBridge, ipcRenderer } from "electron";

const subscribe = <T>(channel: string, cb: (payload: T) => void) => {
	const handler = (_event: unknown, payload: T) => cb(payload);
	ipcRenderer.on(channel, handler);
	return () => {
		ipcRenderer.off(channel, handler);
	};
};

contextBridge.exposeInMainWorld("Ob", {
	platform: process.platform,

	selectDirectory: () => ipcRenderer.invoke("ob:selectDirectory"),
	scanPath: (path: string) => ipcRenderer.invoke("ob:scanPath", path),
	getDrives: () => ipcRenderer.invoke("ob:getDrives"),
	getScans: () => ipcRenderer.invoke("ob:getScans"),
	getRenderTree: (path: string, cursor: string[]) =>
		ipcRenderer.invoke("ob:getRenderTree", path, cursor),

	onDrives: (cb: (drives: Ob.PhysicalDrive[]) => void) => {
		const unsub = subscribe<Ob.PhysicalDrive[]>("ob:drives", cb);
		void ipcRenderer.invoke("ob:getDrives").then(cb);
		return unsub;
	},
	onScans: (cb: (scans: Ob.ScanInfo[]) => void) => {
		const unsub = subscribe<Ob.ScanInfo[]>("ob:scans", cb);
		void ipcRenderer.invoke("ob:getScans").then(cb);
		return unsub;
	},
	onSetInspecting: (cb: (path: string | null) => void) =>
		subscribe<string | null>("ob:setInspecting", cb),
	onNav: (cb: (direction: "back" | "forward") => void) =>
		subscribe<"back" | "forward">("ob:nav", cb),
});
