module.exports = {
	packagerConfig: {
		appBundleId: "la.mckay.observatory",
		appCategoryType: "public.app-category.utilities",
		appCopyright: "© 2020 ♥ McKayla",
		darwinDarkModeSupport: true,
		ignore: [/src\/.+/],
		name: "Observatory",
		out: "target",
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
			name: "@electron-forge/maker-squirrel",
			platforms: ["darwin", "linux", "windows"],
		},
	],
};
