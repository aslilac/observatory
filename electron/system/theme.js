import { systemPreferences } from "electron";

import gardens from "../../gardens.config";
const garden = gardens.scope("systemPreferences", "theme");

if (process.platform === "darwin") {
	systemPreferences.subscribeNotification(
		"AppleInterfaceThemeChangedNotification",
		() => garden.log(`Dark mode: ${systemPreferences.isDarkMode()}`),
	);
}
