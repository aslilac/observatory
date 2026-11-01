import { fileURLToPath } from "node:url";
import { release } from "./release-plugin.ts";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default {
	base: "./",
	plugins: [release()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rolldownOptions: {
			input: {
				index: page("./index.html"),
				download: page("./download/index.html"),
			},
		},
	},
	server: { port: 5180 },
	preview: { port: 5181 },
} satisfies import("vite").UserConfig;
