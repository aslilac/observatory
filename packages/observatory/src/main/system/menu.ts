import { Menu, shell } from "electron";

import showAboutWindow from "./about";

const template = [
	// { role: 'appMenu' }
	...(process.platform === "darwin"
		? [
				{
					label: "File",
					submenu: [
						{
							label: "About Observatory",
							click() {
								showAboutWindow();
							},
						},
						{ type: "separator" },
						{ role: "services" },
						{ type: "separator" },
						{ role: "hide" },
						{ role: "hideothers" },
						{ role: "unhide" },
						{ type: "separator" },
						{ role: "quit" },
					],
				},
		  ]
		: []),
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "delete" },
		],
	},
	{
		label: "View",
		submenu: [
			{ role: "reload" },
			{ role: "forcereload" },
			{ role: "toggledevtools" },
			{ type: "separator" },
			{ role: "togglefullscreen" },
		],
	},
	{
		label: "Window",
		submenu: [
			{ role: "close" },
			{ role: "minimize" },
			...(process.platform === "darwin"
				? [
						// Remember that this is what macOS calls maximizing
						{ role: "zoom" },
						{ type: "separator" },
						{ role: "front" },
						{ type: "separator" },
						{ role: "window" },
				  ]
				: []),
		],
	},
	{
		role: "help",
		submenu: [
			{
				label: "Visit GitHub",
				click() {
					shell.openExternal(
						"https://github.com/partheseas/observatory",
					);
				},
			},
			{
				label: "Report an issue 🐛",
				click() {
					shell.openExternal(
						"https://github.com/partheseas/observatory/issues",
					);
				},
			},
			...(process.platform === "darwin"
				? []
				: [
						{ type: "separator" },
						{
							label: "About Observatory",
							click: () => showAboutWindow(),
						},
				  ]),
		],
	},
];

// Menu.setApplicationMenu(Menu.buildFromTemplate(template));
