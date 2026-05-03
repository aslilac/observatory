import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";

import { selectDirectory } from "../bridge";
import showAboutWindow from "./about";

const isMac = process.platform === "darwin";

const template: MenuItemConstructorOptions[] = [
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
				click: () => void selectDirectory(),
			},
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
					void shell.openExternal("https://github.com/partheseas/observatory"),
			},
			{
				label: "Report an Issue",
				click: () =>
					void shell.openExternal(
						"https://github.com/partheseas/observatory/issues",
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

app.on("ready", () => {
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
});
