// The landing page. Vite and TypeScript come from the repo root's node_modules.
export default {
	// relative URLs, so dist/ works wherever it's served from (a domain's root, or
	// a GitHub Pages project path)
	base: "./",
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: { port: 5180 },
	preview: { port: 5181 },
} satisfies import("vite").UserConfig;
