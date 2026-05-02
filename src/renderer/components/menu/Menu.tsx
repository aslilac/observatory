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
		<section className="px-[0.4in] py-[0.3in]">
			<ul
				id="menu-drivelist"
				className="m-0 list-none overflow-hidden rounded p-0 [box-shadow:0_0_5px_#0004,0_1px_2px_#0006]"
			>
				{drives.map((drive) => {
					const scan = scanByPath.get(drive.mountPath);
					return (
						<li
							key={drive.mountPath}
							className="grid grid-cols-[1fr_auto] items-center bg-menu-row p-4 not-last:border-b not-last:border-b-menu-divider"
						>
							<span>
								{drive.description} - {scan?.status ?? "not scanned"}
							</span>
							{scan ? (
								<button
									className="btn"
									onClick={() => onInspect(drive.mountPath)}
									disabled={scan.status !== "complete"}
								>
									View
								</button>
							) : (
								<button className="btn" onClick={() => onScan(drive.mountPath)}>
									Scan
								</button>
							)}
						</li>
					);
				})}
				{nonDriveScans.map((scan) => (
					<li
						key={scan.path}
						className="grid grid-cols-[1fr_auto] items-center bg-menu-row p-4 not-last:border-b not-last:border-b-menu-divider"
					>
						<span>
							{scan.path} - {scan.status}
						</span>
						<button
							className="btn"
							onClick={() => onInspect(scan.path)}
							disabled={scan.status !== "complete"}
						>
							View
						</button>
					</li>
				))}
			</ul>
			<button className="btn" onClick={() => void Ob.selectDirectory()}>
				Scan directory
			</button>
		</section>
	);
};
