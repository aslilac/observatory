import { list as drivelist } from "drivelist";
import { BrowserWindow, dialog, TouchBar } from "electron";
const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = TouchBar;

import { createVfs, store } from "../../store/main";

export const init = async (view: BrowserWindow) => {
	const list = await drivelist();
	view.setTouchBar(
		new TouchBar({
			items: [
				new TouchBarButton({
					label: "Disks and folders",
					backgroundColor: "#232358",
					click() {
						console.log("[touchbar]", "Hello");
					},
				}),
				new TouchBarSpacer({
					size: "large",
				}),
				new TouchBarLabel({
					label: "Scan ",
					textColor: "#b991e6",
				}),
				...list.flatMap((device) =>
					device.mountpoints.map(
						(mount) =>
							new TouchBarButton({
								label:
									mount.label ||
									`${mount.path} (${device.description})`,
								backgroundColor: "#9680ed",
								async click() {
									store.dispatch(createVfs(mount.path));
								},
							}),
					),
				),
				new TouchBarSpacer({
					size: "small",
				}),
				new TouchBarButton({
					label: "Scan directory",
					backgroundColor: "#b0a0ec",
					async click() {
						const result = await dialog.showOpenDialog({
							properties: ["openDirectory"],
						});

						if (!result.canceled)
							store.dispatch(createVfs(result.filePaths[0]));
					},
				}),
				new TouchBarSpacer({
					size: "large",
				}),
			],
		}),
	);
};

export default { init };
