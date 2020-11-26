import { systemPreferences } from "electron";

if (process.platform === "darwin") {
	systemPreferences.subscribeNotification(
		"AppleInterfaceThemeChangedNotification",
		() =>
			console.log(
				"[theme]",
				`Dark mode: ${systemPreferences.isDarkMode()}`,
			),
	);
}
