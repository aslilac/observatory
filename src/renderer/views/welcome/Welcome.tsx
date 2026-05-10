import type { RecentScan } from "#/state";
import { readableSize } from "#/util";
import { Button } from "#/components/Button";
import { Toolbar } from "#/components/Toolbar";

type WelcomeProps = {
	drives: Ob.PhysicalDrive[];
	scans: Ob.ScanInfo[];
	recent: RecentScan[];
	onOpen: (path: string) => void;
	chips: React.ReactNode;
};

export const Welcome: React.FC<WelcomeProps> = ({
	drives,
	scans,
	recent,
	onOpen,
	chips,
}) => {
	const scanByPath = new Map(scans.map((s) => [s.path, s]));
	return (
		<>
			<Toolbar chips={chips} />
			<div className="flex flex-1 flex-col gap-6 overflow-auto px-8 py-6">
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
						<div className="eyebrow mb-2">Disks</div>
						<div className="grid grid-cols-2 gap-[10px]">
							{drives.map((drive) => (
								<VolumeCard
									key={drive.mountPath}
									drive={drive}
									scan={scanByPath.get(drive.mountPath)}
									onOpen={() => onOpen(drive.mountPath)}
								/>
							))}
						</div>
					</div>
				)}

				<div>
					<div className="eyebrow mb-2">Folders</div>
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
				</div>

				{recent.length > 0 && (
					<div>
						<div className="eyebrow mb-2">Recent</div>
						<div className="overflow-hidden rounded-card border border-line-soft">
							{recent.map((entry, i) => {
								const scan = scanByPath.get(entry.path);
								return (
									<button
										key={entry.path}
										type="button"
										onClick={() => onOpen(entry.path)}
										className={`flex w-full items-center px-[12px] py-[9px] text-left text-[12px] ${
											i < recent.length - 1 ? "border-b border-line-soft" : ""
										} hover:bg-fill`}
									>
										<span className="flex-1 truncate">{entry.path}</span>
										<span className="mr-[14px] text-muted">
											{formatDate(entry.scannedAt)}
										</span>
										<span className="w-[100px] text-right font-mono">
											{scan?.status === "complete" ? (
												<span className="text-default">
													{scan.size !== undefined
														? readableSize(scan.size)
														: "scanned"}
												</span>
											) : scan?.status === "building" ? (
												<span className="text-muted">scanning</span>
											) : (
												<span className="text-muted">—</span>
											)}
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
	onOpen: () => void;
};

const VolumeCard: React.FC<VolumeCardProps> = ({ drive, scan, onOpen }) => {
	const status = scan?.status;
	return (
		<button
			type="button"
			onClick={onOpen}
			className={`
				flex items-center gap-3 p-3 rounded-card
				border border-line text-left transition-shadow hover:shadow-window
			`}
		>
			<div className="grid h-[36px] w-[36px] flex-shrink-0 place-items-center rounded-button border border-line">
				<div className="h-[16px] w-[12px] rounded-[1px] border-[1.25px] border-default" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-semibold">
					{drive.description}
				</div>
				<div className="truncate font-mono text-[11px] text-muted">
					{drive.mountPath}
				</div>
			</div>
			<span className="font-mono text-[11px] text-muted">
				{status === "complete" && scan?.size && readableSize(scan.size)}
				{status === "building" && "Scanning…"}
			</span>
		</button>
	);
};

function formatDate(ts: number): string {
	const d = new Date(ts);
	const month = d.toLocaleString("en-US", { month: "short" });
	return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
