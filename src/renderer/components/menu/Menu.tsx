import React, { useEffect } from "react";

type MenuProps = {
	drives: Ob.PhysicalDrive[];
	scans: Ob.ScanInfo[];
	onInspect: (path: string) => void;
	onScan: (path: string) => void;
};

export const Menu = ({ drives, scans, onInspect, onScan }: MenuProps) => {
	useEffect(() => {
		void Ob.sizeToMenu();
	}, [drives, scans]);

	const driveByPath = new Map(drives.map((d) => [d.mountPath, d]));
	const scanByPath = new Map(scans.map((s) => [s.path, s]));

	const nonDriveScans = scans.filter((s) => !driveByPath.has(s.path));

	return (
		<section>
			<ul id="menu-drivelist">
				{drives.map((drive) => {
					const scan = scanByPath.get(drive.mountPath);
					return (
						<li key={drive.mountPath}>
							{drive.description} - {scan?.status ?? "not scanned"}
							{scan ? (
								<button
									onClick={() => onInspect(drive.mountPath)}
									disabled={scan.status !== "complete"}
								>
									View
								</button>
							) : (
								<button onClick={() => onScan(drive.mountPath)}>Scan</button>
							)}
						</li>
					);
				})}
				{nonDriveScans.map((scan) => (
					<li key={scan.path}>
						{scan.path} - {scan.status}
						<button
							onClick={() => onInspect(scan.path)}
							disabled={scan.status !== "complete"}
						>
							View
						</button>
					</li>
				))}
			</ul>
			<button onClick={() => void Ob.selectDirectory()}>Scan directory</button>
		</section>
	);
};
