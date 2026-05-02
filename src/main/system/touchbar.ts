import { BrowserWindow, TouchBar } from "electron";
const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = TouchBar;

import { selectDirectory, setInspecting } from "../bridge";
import {
	getDrives,
	getScans,
	onDrivesChange,
	onScansChange,
} from "../vfsManager";

const refreshAll = () => BrowserWindow.getAllWindows().forEach(initTouchBar);

onDrivesChange(refreshAll);
onScansChange(refreshAll);

export const initTouchBar = (view: BrowserWindow) => {
	const drives = getDrives();
	const scans = getScans();
	const driveByPath = new Map(drives.map((d) => [d.mountPath, d]));

	view.setTouchBar(
		new TouchBar({
			items: [
				new TouchBarButton({
					label: "Disks and folders",
					backgroundColor: "#232358",
					click: () => setInspecting(null),
				}),
				new TouchBarSpacer({
					size: "large",
				}),
				new TouchBarLabel({
					label: "View ",
					textColor: "#b991e6",
				}),
				...scans.map(
					(scan) =>
						new TouchBarButton({
							label: driveByPath.get(scan.path)?.description ?? scan.path,
							backgroundColor: scan.status === "complete" ? "#9680ed" : "#aaa",
							enabled: scan.status === "complete",
							click: () => setInspecting(scan.path),
						}),
				),
				new TouchBarSpacer({
					size: "small",
				}),
				new TouchBarButton({
					label: "Scan directory",
					backgroundColor: "#b0a0ec",
					click: () => void selectDirectory(),
				}),
				new TouchBarSpacer({
					size: "large",
				}),
			],
		}),
	);
};
