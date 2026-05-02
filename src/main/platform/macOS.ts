import { nativeTheme, systemPreferences } from "electron";

if (process.platform === "darwin") {
	systemPreferences.subscribeNotification(
		"AppleInterfaceThemeChangedNotification",
		() =>
			console.log("[theme]", `Dark mode: ${nativeTheme.shouldUseDarkColors}`),
	);
}
