import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";
import * as path from "node:path";
import { openScan } from "./broadcast";
import { selectDirectory } from "./dialog";
import { showAboutWindow } from "./viewManager";

const isMac = process.platform === "darwin";

type RecentScan = { path: string; scannedAt: number };

// Latest list pushed by the renderer. The renderer owns the canonical store
// (localStorage) and re-publishes whenever it changes; we just rebuild the
// menu around the current snapshot.
let recentScans: RecentScan[] = [];

// Node's basename splits the way the platform does. A root ("/", "C:\")
// has no name, so it's its own label.
function recentLabel(p: string): string {
	return path.basename(p) || p;
}

function recentItems(): MenuItemConstructorOptions[] {
	if (recentScans.length === 0) {
		return [{ label: "(no recent scans)", enabled: false }];
	}
	return recentScans.map((scan) => ({
		label: recentLabel(scan.path),
		sublabel: scan.path,
		toolTip: scan.path,
		click: () => openScan(scan.path),
	}));
}

function buildTemplate(): MenuItemConstructorOptions[] {
	return [
		// macOS expects an "appMenu" role with the app's name as label. The
		// system uses it for About / Quit / Hide / Services bindings; without
		// it Cmd-Q goes through Electron's defaults and the About entry won't
		// show up where users look for it. The name is spelled out, here and
		// in the items that would take it from app.name: that's package.json's,
		// which is lowercase.
		...(isMac
			? ([
					{
						label: "Observatory",
						submenu: [
							{ label: "About Observatory", click: () => showAboutWindow() },
							{ type: "separator" },
							{ role: "services" },
							{ type: "separator" },
							{ role: "hide", label: "Hide Observatory" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							{ role: "quit", label: "Quit Observatory" },
						],
					},
				] satisfies MenuItemConstructorOptions[])
			: []),
		{
			label: "File",
			submenu: [
				{
					label: "Open Folder…",
					accelerator: "CmdOrCtrl+O",
					click: () => {
						void selectDirectory().then((picked) => {
							if (picked) {
								openScan(picked);
							}
						});
					},
				},
				{ label: "Open Recent", submenu: recentItems() },
				{ type: "separator" },
				isMac ? { role: "close" } : { role: "quit" },
			],
		},
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
		{
			role: "help",
			submenu: [
				{
					label: "Visit GitHub",
					click: () =>
						void shell.openExternal("https://github.com/aslilac/observatory"),
				},
				{
					label: "Report an Issue",
					click: () =>
						void shell.openExternal(
							"https://github.com/aslilac/observatory/issues",
						),
				},
				...(isMac
					? []
					: ([
							{ type: "separator" },
							{ label: "About Observatory", click: () => showAboutWindow() },
						] satisfies MenuItemConstructorOptions[])),
			],
		},
	];
}

function applyMenu() {
	Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}

export function setRecentScans(next: ReadonlyArray<RecentScan>) {
	recentScans = next.slice();
	applyMenu();
}

app.on("ready", applyMenu);
