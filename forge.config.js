module.exports = {
	packagerConfig: {
		appBundleId: "dev.mckayla.observatory",
		appCategoryType: "public.app-category.utilities",
		appCopyright: "© 2023 ♥ McKayla",
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
			platforms: ["win32"],
		},
		{
			name: "@electron-forge/maker-zip",
			platforms: ["darwin", "linux", "win32"],
		},
	],
};
