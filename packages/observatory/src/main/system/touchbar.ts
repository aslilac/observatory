import { BrowserWindow, TouchBar } from "electron";
const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = TouchBar;

import { dispatch, inspectVfs, showDriveList, store, subscribe } from "../../store/main";
import * as Ob from "../bridge";

subscribe(() => BrowserWindow.getAllWindows().forEach(initTouchBar));

export const initTouchBar = async (view: BrowserWindow) => {
	const state = store.getState();

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
					label: "View ",
					textColor: "#b991e6",
				}),
				...Array.from(state.vfs.keys()).map(
					(vfsPath) =>
						new TouchBarButton({
							label: state.drives.has(vfsPath)
								? state.drives.get(vfsPath)!.description
								: vfsPath,
							backgroundColor:
								state.vfs.get(vfsPath)!.status === "complete"
									? "#9680ed"
									: "#aaa",
							enabled: state.vfs.get(vfsPath)!.status === "complete",
							click: () => dispatch(inspectVfs(vfsPath)),
						}),
				),
				new TouchBarSpacer({
					size: "small",
				}),
				new TouchBarButton({
					label: "Scan directory",
					backgroundColor: "#b0a0ec",
					click: Ob.selectDirectory,
				}),
				new TouchBarSpacer({
					size: "large",
				}),
			],
		}),
	);
};
