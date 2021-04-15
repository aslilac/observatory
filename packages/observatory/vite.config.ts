import type { UserConfig } from "vite";

export default {
	root: "src/renderer",
	base: "./",
	build: { outDir: "../../target/renderer" },
} as UserConfig;
