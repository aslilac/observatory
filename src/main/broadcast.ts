import { webContents } from "electron";

// Send `payload` on `channel` to every live renderer. Used by both bridge.ts
// (vfsManager change events) and the menu (so File > Open Recent can hop the
// renderer to the scan it just kicked off) — extracted here so neither side
// has to import the other.
export function broadcast(channel: string, payload: unknown) {
	for (const view of webContents.getAllWebContents()) {
		if (!view.isDestroyed()) view.send(channel, payload);
	}
}

export function setInspecting(path: string | null) {
	broadcast("Ob.setInspecting", path);
}
