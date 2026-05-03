import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

// One config to drive all three Electron processes. Outputs land under
// build/ to match the existing layout (forge.config.js, .gitignore, etc.):
//   build/main/index.js   — main process bundle
//   build/preload.js      — preload, CJS, single file (require.resolve from
//                           viewManager finds it without extension)
//   build/renderer/       — renderer entries (index.html + about.html) plus
//                           hashed assets
export default {
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "build/main/",
			emptyOutDir: true,
			rolldownOptions: {
				input: { index: resolve(__dirname, "src/main/index.ts") },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "build/preload/",
			emptyOutDir: true,
			rolldownOptions: {
				input: { index: resolve(__dirname, "src/preload/index.ts") },
			},
		},
	},
	renderer: {
		root: resolve(__dirname, "src/renderer/"),
		plugins: [
			react({
				babel: {
					plugins: [["babel-plugin-react-compiler", {}]],
				},
			}),
			tailwindcss(),
		],
		build: {
			outDir: resolve(__dirname, "build/renderer/"),
			emptyOutDir: true,
			rolldownOptions: {
				input: {
					index: resolve(__dirname, "src/renderer/index.html"),
					about: resolve(__dirname, "src/renderer/about.html"),
				},
			},
		},
	},
} satisfies import("electron-vite").UserConfig;

/Applications
