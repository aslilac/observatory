import { contextBridge, ipcRenderer, webUtils } from "electron";

export const PERF = process.env["OB_PERF"] === "1";

function approxBytes(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return 0;
	}
}

const invoke = PERF ? timedInvoke : ipcRenderer.invoke;

async function timedInvoke(
	channel: string,
	...args: unknown[]
): Promise<unknown> {
	const start = performance.now();
	const result = await ipcRenderer.invoke(channel, ...args);
	const elapsed = performance.now() - start;
	const bytes = approxBytes(result);
	console.log(
		`[perf:ipc:${channel}]  time=${elapsed.toFixed(1)}ms  size=${(bytes / 1000).toFixed(0)}kb`,
	);
	return result;
}

const subscribe = <T>(channel: string, cb: (payload: T) => void) => {
	const handler = (_event: unknown, payload: T) => cb(payload);
	ipcRenderer.on(channel, handler);
	return () => {
		ipcRenderer.off(channel, handler);
	};
};

contextBridge.exposeInMainWorld("Ob", {
	PERF,
	platform: process.platform,

	selectDirectory: () => invoke("Ob.selectDirectory"),
	scanPath: (path: string) => invoke("Ob.scanPath", path),
	cancelScan: (path: string) => invoke("Ob.cancelScan", path),
	getDrives: () => invoke("Ob.getDrives"),
	getScans: () => invoke("Ob.getScans"),
	getRenderTree: (path: string, cursor: string[]) =>
		invoke("Ob.getRenderTree", path, cursor),
	getScanProgress: (path: string) => invoke("Ob.getScanProgress", path),
	getScanPerfTree: (path: string) => invoke("Ob.getScanPerfTree", path),
	deleteFiles: (paths: string[]) => invoke("Ob.deleteFiles", paths),
	searchScan: (path: string, query: string) =>
		invoke("Ob.searchScan", path, query),
	getScanErrors: (path: string) => invoke("Ob.getScanErrors", path),
	statPath: (path: string) => invoke("Ob.statPath", path),
	pathForFile: (file: File) => webUtils.getPathForFile(file),
	publishRecentScans: (
		recents: ReadonlyArray<{ path: string; scannedAt: number }>,
	) => invoke("Ob.publishRecentScans", recents),
	revealInFinder: (path: string) => invoke("Ob.revealInFinder", path),
	openPath: (path: string) => invoke("Ob.openPath", path),
	openFullDiskAccessSettings: () => invoke("Ob.openFullDiskAccessSettings"),
	devLoadFakeDisk: () => invoke("Ob.devLoadFakeDisk"),

	onDrives: (cb: (drives: Ob.PhysicalDrive[]) => void) => {
		const unsub = subscribe<Ob.PhysicalDrive[]>("Ob.drives", cb);
		void invoke("Ob.getDrives").then((drives) =>
			cb(drives as Ob.PhysicalDrive[]),
		);
		return unsub;
	},
	onScans: (cb: (scans: Ob.ScanInfo[]) => void) => {
		const unsub = subscribe<Ob.ScanInfo[]>("Ob.scans", cb);
		void invoke("Ob.getScans").then((scans) => cb(scans as Ob.ScanInfo[]));
		return unsub;
	},
	onSetInspecting: (cb: (path: string | null) => void) =>
		subscribe<string | null>("Ob.setInspecting", cb),
	onNav: (cb: (direction: "back" | "forward") => void) =>
		subscribe<"back" | "forward">("Ob.nav", cb),
});
