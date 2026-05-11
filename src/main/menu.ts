import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { setInspecting } from "./broadcast";
import { selectDirectory } from "./dialog";
import { startScan } from "./vfsManager";
import { showAboutWindow } from "./viewManager";

const isMac = process.platform === "darwin";

type RecentScan = { path: string; scannedAt: number };

// Latest list pushed by the renderer. The renderer owns the canonical store
// (localStorage) and re-publishes whenever it changes; we just rebuild the
// menu around the current snapshot.
let recentScans: RecentScan[] = [];

function recentLabel(p: string): string {
	const trimmed = p.replace(/[/\\]+$/, "") || p;
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
	return base || trimmed;
}

function recentItems(): MenuItemConstructorOptions[] {
	if (recentScans.length === 0) {
		return [{ label: "(no recent scans)", enabled: false }];
	}
	return [
		...recentScans.map((scan) => ({
			label: recentLabel(scan.path),
			sublabel: scan.path,
			toolTip: scan.path,
			click: () => {
				startScan(scan.path);
				setInspecting(scan.path);
			},
		})),
	];
}

function buildTemplate(): MenuItemConstructorOptions[] {
	return [
		// macOS expects an "appMenu" role with the app's name as label. The
		// system uses it for About / Quit / Hide / Services bindings; without
		// it Cmd-Q goes through Electron's defaults and the About entry won't
		// show up where users look for it.
		...(isMac
			? ([
					{
						label: app.name,
						submenu: [
							{ label: `About ${app.name}`, click: () => showAboutWindow() },
							{ type: "separator" },
							{ role: "services" },
							{ type: "separator" },
							{ role: "hide" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							{ role: "quit" },
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
							if (!picked) return;
							startScan(picked);
							setInspecting(picked);
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
