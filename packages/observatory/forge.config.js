module.exports = {
	packagerConfig: {
		appBundleId: "dev.mckayla.observatory",
		appCategoryType: "public.app-category.utilities",
		appCopyright: "© 2020 ♥ McKayla",
		asar: false,
		darwinDarkModeSupport: true,
		derefSymlinks: true,
		ignore: [/scripts\/.+/, /src\/.+/],
		name: "Observatory",
	},
	makers: [
		{
			name: "@electron-forge/maker-dmg",
			platforms: ["darwin"],
		},
		{
			name: "@electron-forge/maker-squirrel",
			platforms: ["windows"],
		},
		{
			name: "@electron-forge/maker-zip",
			platforms: ["darwin", "linux", "windows"],
		},
	],
};
