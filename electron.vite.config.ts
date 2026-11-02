import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The commit the build is of, and whether the checkout had changes, for the
// about window and bug reports: "<sha>" or "<sha>-dirty". The Flatpak builds
// a copy without .git, so flatpak/build.sh (and the release workflow) write
// it to .commit first.
function commit(): string | null {
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: __dirname, encoding: "utf8" }).trim();
	try {
		const sha = git("rev-parse", "HEAD");
		return git("status", "--porcelain") ? `${sha}-dirty` : sha;
	} catch {
		try {
			return readFileSync(resolve(__dirname, ".commit"), "utf8").trim() || null;
		} catch {
			return null;
		}
	}
}

export default {
	main: {
		define: { __COMMIT__: JSON.stringify(commit()) },
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
		plugins: [react({ compiler: true }), tailwindcss()],
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
