import { contextBridge, ipcRenderer, webUtils } from "electron";

// Same flag the renderer uses; preload runs in the same origin so
// localStorage is shared. Read lazily so toggling at runtime takes effect.
function perfEnabled(): boolean {
	try {
		return globalThis.localStorage?.getItem("observatory:perf") === "1";
	} catch {
		return false;
	}
}

function approxBytes(value: unknown): number {
	try {
		return JSON.stringify(value ?? null).length;
	} catch {
		return 0;
	}
}

async function timedInvoke(
	channel: string,
	...args: unknown[]
): Promise<unknown> {
	if (!perfEnabled()) return ipcRenderer.invoke(channel, ...args);
	const start = performance.now();
	const result = await ipcRenderer.invoke(channel, ...args);
	const elapsed = performance.now() - start;
	const bytes = approxBytes(result);
	console.log(
		`[perf:ipc] ${channel} ${elapsed.toFixed(1)}ms / ${bytes.toLocaleString()}B`,
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
	platform: process.platform,

	selectDirectory: () => timedInvoke("ob:selectDirectory"),
	scanPath: (path: string) => timedInvoke("ob:scanPath", path),
	cancelScan: (path: string) => timedInvoke("ob:cancelScan", path),
	getDrives: () => timedInvoke("ob:getDrives"),
	getScans: () => timedInvoke("ob:getScans"),
	getRenderTree: (path: string, cursor: string[]) =>
		timedInvoke("ob:getRenderTree", path, cursor),
	getScanProgress: (path: string) => timedInvoke("ob:getScanProgress", path),
	deleteFiles: (paths: string[]) => timedInvoke("ob:deleteFiles", paths),
	searchScan: (path: string, query: string) =>
		timedInvoke("ob:searchScan", path, query),
	getScanErrors: (path: string) => timedInvoke("ob:getScanErrors", path),
	statPath: (path: string) => timedInvoke("ob:statPath", path),
	pathForFile: (file: File) => webUtils.getPathForFile(file),
	publishRecentScans: (
		recents: ReadonlyArray<{ path: string; scannedAt: number }>,
	) => timedInvoke("ob:publishRecentScans", recents),
	revealInFinder: (path: string) => timedInvoke("ob:revealInFinder", path),
	openPath: (path: string) => timedInvoke("ob:openPath", path),

	onDrives: (cb: (drives: Ob.PhysicalDrive[]) => void) => {
		const unsub = subscribe<Ob.PhysicalDrive[]>("ob:drives", cb);
		void timedInvoke("ob:getDrives").then((drives) =>
			cb(drives as Ob.PhysicalDrive[]),
		);
		return unsub;
	},
	onScans: (cb: (scans: Ob.ScanInfo[]) => void) => {
		const unsub = subscribe<Ob.ScanInfo[]>("ob:scans", cb);
		void timedInvoke("ob:getScans").then((scans) => cb(scans as Ob.ScanInfo[]));
		return unsub;
	},
	onSetInspecting: (cb: (path: string | null) => void) =>
		subscribe<string | null>("ob:setInspecting", cb),
	onNav: (cb: (direction: "back" | "forward") => void) =>
		subscribe<"back" | "forward">("ob:nav", cb),
});
