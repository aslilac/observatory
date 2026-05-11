module.exports = {
	packagerConfig: {
		appBundleId: "dev.mckayla.observatory",
		appCategoryType: "public.app-category.utilities",
		appCopyright: "© 2019-2026 McKayla Washburn-Love ♥",
		asar: {
			// Native modules can't be require()'d from inside an asar archive.
			// Forge writes them to app.asar.unpacked/ instead and Electron's
			// asar layer transparently rewrites require() paths so the main
			// process's `path.resolve(app.getAppPath(), "rust-backend/...")`
			// resolves to the unpacked copy without any code changes.
			unpack: "**/*.node",
		},
		darwinDarkModeSupport: true,
		derefSymlinks: true,
		// Forge appends the right extension per platform — .icns on darwin,
		// .ico on win32, .png on linux. Drop a hand-built icon.icns into
		// build-resources/ to enable proper macOS packaging.
		icon: "./build-resources/icon",
		ignore: (filePath) => {
			// Forge calls this with leading-slash relative paths. The first
			// call passes "" (the project root); never reject that.
			if (filePath === "") {
				return false;
			}
			if (filePath.startsWith("/scripts")) {
				return true;
			}
			if (filePath.startsWith("/src")) {
				return true;
			}
			// rust-backend ships only the .node binary. Source, manifests,
			// the bench script, and the cargo target dir all stay out.
			if (filePath === "/rust-backend") {
				return false;
			}
			if (filePath.startsWith("/rust-backend/")) {
				return filePath !== "/rust-backend/observatory_scan.node";
			}
			return false;
		},
		name: "Observatory",
	},
	makers: [
		{
			name: "@electron-forge/maker-dmg",
			platforms: ["darwin"],
			config: {
				icon: "./build-resources/icon.icns",
			},
		},
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
