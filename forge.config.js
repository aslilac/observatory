module.exports = {
	packagerConfig: {
		appBundleId: "dev.mckayla.observatory",
		appCategoryType: "public.app-category.utilities",
		appCopyright: "© 2019-2026 McKayla Washburn-Love ♥",
		asar: true,
		darwinDarkModeSupport: true,
		derefSymlinks: true,
		// Forge appends the right extension per platform — .icns on darwin,
		// .ico on win32, .png on linux. Drop a hand-built icon.icns into
		// build-resources/ to enable proper macOS packaging.
		icon: "./build-resources/icon",
		ignore: [/scripts\/.+/, /src\/.+/],
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
