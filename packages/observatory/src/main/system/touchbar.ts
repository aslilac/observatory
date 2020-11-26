import { list as drivelist } from "drivelist";
import { BrowserWindow, dialog, TouchBar } from "electron";
const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = TouchBar;

import { createVfs, showDriveList, store } from "../../store/main";
const { dispatch } = store;

export const init = async (view: BrowserWindow) => {
	const list = await drivelist();
	view.setTouchBar(
		new TouchBar({
			items: [
				new TouchBarButton({
					label: "Disks and folders",
					backgroundColor: "#232358",
					click: () => dispatch(showDriveList()),
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
								click: () => dispatch(createVfs(mount.path)),
							}),
					),
				),
				new TouchBarSpacer({
					size: "small",
				}),
				new TouchBarButton({
					label: "Scan directory",
					backgroundColor: "#b0a0ec",
					click: async () => {
						const result = await dialog.showOpenDialog({
							properties: ["openDirectory"],
						});

						if (!result.canceled) {
							result.filePaths.forEach((path) =>
								dispatch(createVfs(path)),
							);
						}
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
