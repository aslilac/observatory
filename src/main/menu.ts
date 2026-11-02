import {
	app,
	BrowserWindow,
	Menu,
	type MenuItem,
	type MenuItemConstructorOptions,
	shell,
	type WebContents,
} from "electron";
import * as path from "node:path";
import { broadcast, openScan } from "./broadcast";
import { selectDirectory } from "./dialog";
import { reportIssue } from "./environment";
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

// Where the window is, published by the renderer (Ob.publishMenuState) as
// it changes, for what's enabled and checked.
let state: Ob.MenuState = {
	canBack: false,
	canForward: false,
	scan: null,
	folder: null,
	canFind: false,
	cleanupOpen: false,
	theme: "light",
};

export function setMenuState(next: Ob.MenuState) {
	state = next;
	applyMenu();
}

// The app does it: they're about what's on screen, which it knows.
function command(name: Ob.MenuCommand): MenuItemConstructorOptions["click"] {
	return (_item, window) => {
		const target =
			window instanceof BrowserWindow
				? window
				: BrowserWindow.getFocusedWindow();
		target?.webContents.send("Ob.menuCommand", name);
	};
}

function nav(
	direction: "back" | "forward",
): MenuItemConstructorOptions["click"] {
	return (_item, window) => {
		const target =
			window instanceof BrowserWindow
				? window
				: BrowserWindow.getFocusedWindow();
		target?.webContents.send("Ob.nav", direction);
	};
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
							{
								label: "About Observatory",
								click: () => void showAboutWindow(),
							},
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
				{
					label: "Rescan",
					accelerator: "CmdOrCtrl+R",
					enabled: state.scan !== null,
					click: command("rescan"),
				},
				{
					label: isMac ? "Reveal in Finder" : "Show in Folder",
					enabled: state.folder !== null,
					click: command("reveal"),
				},
				{ type: "separator" },
				isMac ? { role: "close" } : { role: "quit" },
			],
		},
		// On macOS, the Edit menu is what makes ⌘C and ⌘V work in text
		// fields. Elsewhere they work without it, and the only field is Find.
		...(isMac
			? ([{ role: "editMenu" }] satisfies MenuItemConstructorOptions[])
			: []),
		{
			label: "View",
			submenu: [
				{
					label: "Find…",
					accelerator: "CmdOrCtrl+F",
					enabled: state.canFind,
					click: command("find"),
				},
				{
					label: "Show Cleanup",
					type: "checkbox",
					checked: state.cleanupOpen,
					click: command("toggle-cleanup"),
				},
				{
					label: "Dark Mode",
					type: "checkbox",
					checked: state.theme === "dark",
					click: command("toggle-theme"),
				},
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
				// For working on the app: Reload throws away where you are, and
				// ⌘R / Ctrl+R is Rescan.
				...(app.isPackaged
					? []
					: ([
							{ type: "separator" },
							{ role: "reload", accelerator: "F5" },
							{ role: "forceReload", accelerator: "Shift+F5" },
							{ role: "toggleDevTools" },
						] satisfies MenuItemConstructorOptions[])),
			],
		},
		{
			label: "Go",
			submenu: [
				{
					label: "Back",
					accelerator: isMac ? "Cmd+[" : "Alt+Left",
					enabled: state.canBack,
					click: nav("back"),
				},
				{
					label: "Forward",
					accelerator: isMac ? "Cmd+]" : "Alt+Right",
					enabled: state.canForward,
					click: nav("forward"),
				},
				{ type: "separator" },
				{
					label: "Disks and Folders",
					accelerator: "CmdOrCtrl+Shift+H",
					click: command("home"),
				},
			],
		},
		// The title bar has minimize and close off macOS.
		...(isMac
			? ([{ role: "windowMenu" }] satisfies MenuItemConstructorOptions[])
			: []),
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
					click: () => void reportIssue(),
				},
				...(isMac
					? []
					: ([
							{ type: "separator" },
							{
								label: "About Observatory",
								click: () => void showAboutWindow(),
							},
						] satisfies MenuItemConstructorOptions[])),
			],
		},
	];
}

function applyMenu() {
	Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
	// Only drawn off macOS, but there's no harm in sending it there too.
	broadcast("Ob.appMenu", describeAppMenu());
}

// Windows and Linux: the window has no menu bar, so the title bar draws the
// application menu itself (AppMenuBar in the renderer). A native popup can't
// stand in for it: it takes the mouse while it's open, so hovering the next
// menu wouldn't switch to it. This is the menu as the title bar draws it,
// each item named by where it is ("1.3" is the second menu's fourth item).
export function describeAppMenu(): Ob.AppMenu {
	return describeItems(Menu.getApplicationMenu()?.items ?? [], "").flatMap(
		(item) => (item.kind === "submenu" ? [item] : []),
	);
}

function describeItems(items: MenuItem[], prefix: string): Ob.AppMenuItem[] {
	return items.flatMap((item, i): Ob.AppMenuItem[] => {
		if (!item.visible) {
			return [];
		}
		if (item.type === "separator") {
			return [{ kind: "separator" }];
		}
		const id = `${prefix}${i}`;
		// "&File" marks the F as the mnemonic, and "&&" is an ampersand.
		const label = item.label.replace(/&(&?)/g, "$1");
		if (item.submenu) {
			return [
				{
					kind: "submenu",
					label,
					enabled: item.enabled,
					items: describeItems(item.submenu.items, `${id}.`),
				},
			];
		}
		// Items with a role (Copy, Reload, …) have the role's shortcut, which
		// Electron has but doesn't declare.
		const accelerator =
			item.accelerator ??
			(
				item as MenuItem & { getDefaultRoleAccelerator?: () => string | null }
			).getDefaultRoleAccelerator?.();
		return [
			{
				kind: "item",
				id,
				label,
				...(item.sublabel ? { sublabel: item.sublabel } : {}),
				enabled: item.enabled,
				...(item.type === "checkbox" || item.type === "radio"
					? { checked: item.checked }
					: {}),
				...(accelerator
					? { accelerator: describeAccelerator(accelerator) }
					: {}),
			},
		];
	});
}

// "CmdOrCtrl+Shift+I" as Windows and Linux spell it: "Ctrl+Shift+I".
function describeAccelerator(accelerator: string): string {
	const names: Record<string, string> = {
		CmdOrCtrl: "Ctrl",
		CommandOrControl: "Ctrl",
		Control: "Ctrl",
		Option: "Alt",
		Plus: "+",
	};
	return accelerator
		.split("+")
		.map((key) => names[key] ?? key)
		.join("+");
}

// Runs the item the title bar's menu says was clicked, as a click on a
// native menu would: its role (Copy, Reload, …) or its handler.
export function clickAppMenuItem(id: string, sender: WebContents) {
	let items = Menu.getApplicationMenu()?.items;
	let item: MenuItem | undefined;
	for (const i of id.split(".")) {
		item = items?.[Number(i)];
		items = item?.submenu?.items;
	}
	if (!item || !item.enabled || item.submenu) {
		return;
	}
	item.click(
		undefined,
		BrowserWindow.fromWebContents(sender) ?? undefined,
		sender,
	);
}

export function setRecentScans(next: ReadonlyArray<RecentScan>) {
	recentScans = next.slice();
	applyMenu();
}

app.on("ready", applyMenu);
