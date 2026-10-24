const fs = require("node:fs/promises");
const path = require("node:path");

// What goes into app.asar: the bundles, the native scanner (and none of
// its sources or cargo's build dir), and the runtime dependencies. Forge
// prunes devDependencies, so anything the bundles already inline (React,
// the icons, the fonts) belongs there, not in dependencies.
const shipped = [
	"/package.json",
	"/build",
	"/node_modules",
	"/src/scanner/observatory_scan.node",
];

module.exports = {
	packagerConfig: {
		appBundleId: "ooo.lilac.observatory",
		appCategoryType: "public.app-category.utilities",
		appCopyright: "© 2019-2026 McKayla Washburn-Love ♥",
		asar: {
			// Native modules can't be require()'d from inside an asar archive.
			// Forge writes them to app.asar.unpacked/ instead and Electron's
			// asar layer transparently rewrites require() paths so the main
			// process's `path.resolve(app.getAppPath(), "src/scanner/...")`
			// resolves to the unpacked copy without any code changes.
			unpack: "**/*.node",
		},
		darwinDarkModeSupport: true,
		derefSymlinks: true,
		// Forge appends the right extension per platform: .icns on darwin,
		// .ico on win32. icon/build.sh generates both. On macOS 26+ the
		// system draws the icon from Assets.car instead (see the hook
		// below), named by CFBundleIconName; older systems use the .icns.
		icon: "./build-resources/icon",
		extendInfo: { CFBundleIconName: "Observatory" },
		ignore: (filePath) => {
			// Forge calls this with leading-slash relative paths. The first
			// call passes "" (the project root); never reject that.
			if (filePath === "") {
				return false;
			}
			// Tool caches (.vite, .vitest-cache) and pnpm's bookkeeping. No
			// package's name starts with a dot.
			if (filePath.startsWith("/node_modules/.")) {
				return true;
			}
			// Everything else in the repo stays out, .git and the icon
			// renders included.
			return !shipped.some(
				(path) =>
					filePath === path ||
					filePath.startsWith(`${path}/`) ||
					path.startsWith(`${filePath}/`),
			);
		},
		name: "Observatory",
	},
	hooks: {
		// The compiled macOS 26 icon goes next to the .icns in
		// Contents/Resources. Not `extraResource`, which would put it in
		// the Windows and Linux builds too.
		packageAfterCopy: async (_config, buildPath, _electron, platform) => {
			if (platform === "darwin" || platform === "mas") {
				await fs.copyFile(
					path.join(__dirname, "build-resources/Assets.car"),
					path.join(buildPath, "../Assets.car"),
				);
			}
		},
	},
	makers: [
		// macOS ships .zip-with-an-.app-inside via the zip maker below.
		// `@electron-forge/maker-dmg` (→ appdmg → ds-store → macos-alias →
		// nan) is broken on Node 22+ — nan uses v8 APIs that have been
		// removed (AccessorSignature, ObjectTemplate::SetAccessor, etc.)
		// and macos-alias hasn't been touched in years. Revisit by wiring
		// `create-dmg` (Homebrew CLI, sidesteps the whole nan toolchain)
		// into a postMake hook if a real .dmg becomes worth the build-
		// machine dep.
		{
			name: "@electron-forge/maker-squirrel",
			platforms: ["win32"],
			config: {
				iconUrl:
					"https://raw.githubusercontent.com/aslilac/observatory/main/build-resources/icon.ico",
				setupIcon: "./build-resources/icon.ico",
			},
		},
		{
			name: "@electron-forge/maker-zip",
			platforms: ["darwin", "linux", "win32"],
		},
	],
};
