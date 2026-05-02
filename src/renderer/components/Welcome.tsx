import React from "react";

import type { RecentScan } from "../state";
import { Button } from "./Button";
import { Toolbar } from "./Toolbar";

type WelcomeProps = {
	drives: Ob.PhysicalDrive[];
	scans: Ob.ScanInfo[];
	recent: RecentScan[];
	onScan: (path: string) => void;
	onInspect: (path: string) => void;
	canBack: boolean;
	canForward: boolean;
	onBack: () => void;
	onForward: () => void;
	chips: React.ReactNode;
};

export const Welcome = ({
	drives,
	scans,
	recent,
	onScan,
	onInspect,
	canBack,
	canForward,
	onBack,
	onForward,
	chips,
}: WelcomeProps) => {
	const scanByPath = new Map(scans.map((s) => [s.path, s]));
	return (
		<>
			<Toolbar
				canBack={canBack}
				canForward={canForward}
				onBack={onBack}
				onForward={onForward}
				chips={chips}
			/>
			<div className="flex flex-1 flex-col gap-[22px] overflow-auto px-[28px] py-[24px]">
				<div>
					<div className="text-[22px] font-semibold tracking-[-0.2px]">
						Pick something to scan
					</div>
					<div className="mt-1 text-[13px] text-muted">
						Choose a mounted volume, drop a folder, or open a recent scan.
					</div>
				</div>

				{drives.length > 0 && (
					<div>
						<div className="eyebrow mb-[8px]">Mounted volumes</div>
						<div className="grid grid-cols-2 gap-[10px]">
							{drives.map((drive, i) => (
								<VolumeCard
									key={drive.mountPath}
									drive={drive}
									scan={scanByPath.get(drive.mountPath)}
									primary={i === 0}
									onScan={() => onScan(drive.mountPath)}
									onInspect={() => onInspect(drive.mountPath)}
								/>
							))}
						</div>
					</div>
				)}

				<div className="flex items-center gap-[14px] rounded-card border-[1.5px] border-dashed border-line px-[18px] py-[14px]">
					<div className="flex-1">
						<div className="text-[13px] font-semibold">
							Drop a folder here to scan
						</div>
						<div className="mt-[2px] font-mono text-[11px] text-muted">
							or paste a path
						</div>
					</div>
					<Button onClick={() => void Ob.selectDirectory()}>
						Choose folder…
					</Button>
				</div>

				{recent.length > 0 && (
					<div>
						<div className="eyebrow mb-[8px]">Recent</div>
						<div className="overflow-hidden rounded-card border border-line-soft">
							{recent.map((entry, i) => {
								const scan = scanByPath.get(entry.path);
								const interactive = scan?.status === "complete";
								return (
									<button
										key={entry.path}
										type="button"
										onClick={
											interactive
												? () => onInspect(entry.path)
												: () => onScan(entry.path)
										}
										className={`flex w-full items-center px-[12px] py-[9px] text-left font-mono text-[12px] ${
											i < recent.length - 1 ? "border-b border-line-soft" : ""
										} hover:bg-fill`}
									>
										<span className="flex-1 truncate">{entry.path}</span>
										<span className="mr-[14px] text-muted">
											{formatDate(entry.scannedAt)}
										</span>
										<span className="w-[80px] text-right text-muted">
											{scan?.status === "complete"
												? "scanned"
												: scan?.status === "building"
													? "scanning"
													: "—"}
										</span>
									</button>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</>
	);
};

type VolumeCardProps = {
	drive: Ob.PhysicalDrive;
	scan?: Ob.ScanInfo;
	primary: boolean;
	onScan: () => void;
	onInspect: () => void;
};

const VolumeCard = ({
	drive,
	scan,
	primary,
	onScan,
	onInspect,
}: VolumeCardProps) => {
	const status = scan?.status;
	const handleClick = status === "complete" ? onInspect : onScan;
	const action =
		status === "complete"
			? "View"
			: status === "building"
				? "Scanning…"
				: "Scan";
	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={status === "building"}
			className={`flex items-center gap-[12px] rounded-card border bg-paper p-[12px] text-left transition-shadow disabled:cursor-default ${
				primary
					? "border-ink shadow-[0_0_0_3px_rgba(26,26,26,0.06)]"
					: "border-line"
			} hover:shadow-window`}
		>
			<div className="grid h-[36px] w-[36px] flex-shrink-0 place-items-center rounded-button border border-line">
				<div className="h-[16px] w-[12px] rounded-[1px] border-[1.25px] border-ink" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-semibold">
					{drive.description}
				</div>
				<div className="truncate font-mono text-[11px] text-muted">
					{drive.mountPath}
				</div>
			</div>
			<span className="font-mono text-[11px] text-muted">{action}</span>
		</button>
	);
};

function formatDate(ts: number): string {
	const d = new Date(ts);
	const month = d.toLocaleString("en-US", { month: "short" });
	return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
