import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default {
	main: {
		build: {
			outDir: "build/main/",
			emptyOutDir: true,
			externalizeDeps: true,
			rolldownOptions: {
				input: { index: resolve(__dirname, "src/main/index.ts") },
			},
		},
	},
	preload: {
		build: {
			outDir: "build/preload/",
			emptyOutDir: true,
			externalizeDeps: true,
			rolldownOptions: {
				input: { index: resolve(__dirname, "src/preload/index.ts") },
			},
		},
	},
	renderer: {
		root: resolve(__dirname, "src/renderer/"),
		plugins: [react(), tailwindcss()],
		resolve: { tsconfigPaths: true },
		build: {
			outDir: resolve(__dirname, "build/renderer/"),
			emptyOutDir: true,
			rolldownOptions: {
				input: {
					index: resolve(__dirname, "src/renderer/index.html"),
					about: resolve(__dirname, "src/renderer/views/about/about.html"),
				},
			},
		},
	},
} satisfies import("electron-vite").UserConfig;
