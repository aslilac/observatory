import {
	FolderIcon,
	FolderOpenIcon,
	HardDriveIcon,
	ServerIcon,
} from "lucide-react";
import { useState } from "react";
import { placeActions } from "#/contextActions";
import type { RecentScan } from "#/state";
import { basename, describeDrive, readableSize } from "#/util";
import { Button } from "#/components/Button";
import { type ContextMenuItem, RowMenu } from "#/components/ContextMenu";
import { Toolbar } from "#/components/Toolbar";
import { CleanupChip } from "../cleanup/CleanupChip";

type WelcomeProps = {
	drives: Ob.PhysicalDrive[];
	scans: Ob.ScanInfo[];
	recent: RecentScan[];
	volumes: Map<string, Ob.DriveUsage>;
	onOpen: (path: string) => void;
	onRescan: (path: string) => void;
	onRemoveRecent: (path: string) => void;
};

export const Welcome: React.FC<WelcomeProps> = ({
	drives,
	scans,
	recent,
	volumes,
	onOpen,
	onRescan,
	onRemoveRecent,
}) => {
	const scanByPath = new Map(scans.map((s) => [s.path, s]));
	const rescanFor = (path: string) => {
		const status = scanByPath.get(path)?.status;
		return status === "complete" || status === "failed"
			? () => onRescan(path)
			: undefined;
	};
	const chooseFolder = () => {
		void Ob.selectDirectory().then((picked) => {
			if (picked) {
				onOpen(picked);
			}
		});
	};

	return (
		<>
			<Toolbar chips={<CleanupChip />} />
			<div className="flex-1 overflow-auto">
				<div className="mx-auto flex max-w-[1280px] flex-col gap-7 p-8">
					{drives.length > 0 && (
						<Section title="Disks">
							{drives.map((drive) => (
								<PlaceRow
									key={drive.mountPath}
									icon={
										drive.network ? (
											<ServerIcon size={16} strokeWidth={1.6} />
										) : (
											<HardDriveIcon size={16} strokeWidth={1.6} />
										)
									}
									title={drive.description}
									detail={
										<span title={drive.mountPath}>{describeDrive(drive)}</span>
									}
									meta={
										<Usage
											volume={drive.usage}
											scan={scanByPath.get(drive.mountPath)}
										/>
									}
									menu={placeActions(drive.mountPath, {
										onRescan: rescanFor(drive.mountPath),
									})}
									onOpen={() => onOpen(drive.mountPath)}
								/>
							))}
						</Section>
					)}

					<Section title="Folders">
						<PlaceRow
							icon={<FolderOpenIcon size={16} strokeWidth={1.6} />}
							action
							title="Open a folder…"
							detail="or drop one onto this window, or paste its path"
							meta={
								<kbd className="rounded-[4px] border border-line px-[5px] py-px font-sans text-[11px] text-muted">
									{Ob.platform === "darwin" ? "⌘O" : "Ctrl+O"}
								</kbd>
							}
							onOpen={chooseFolder}
						/>
						{recent.map((entry) => (
							<PlaceRow
								key={entry.path}
								icon={<FolderIcon size={16} strokeWidth={1.6} />}
								title={basename(entry.path)}
								detail={<span className="font-mono">{entry.path}</span>}
								meta={
									<Usage
										volume={volumes.get(entry.path)}
										scan={scanByPath.get(entry.path)}
										free
									/>
								}
								menu={placeActions(entry.path, {
									onRescan: rescanFor(entry.path),
									onRemove: () => onRemoveRecent(entry.path),
								})}
								onOpen={() => onOpen(entry.path)}
							/>
						))}
					</Section>

					{import.meta.env.DEV && <DevTools onOpen={onOpen} />}
				</div>
			</div>
		</>
	);
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
	title,
	children,
}) => (
	<div>
		<div className="mb-2 eyebrow">{title}</div>
		<div className="divide-y divide-line-soft overflow-hidden rounded-card border border-line">
			{children}
		</div>
	</div>
);

type PlaceRowProps = {
	icon: React.ReactNode;
	title: string;
	detail: React.ReactNode;
	meta?: React.ReactNode;
	// Draws the icon tile as an empty dashed outline: for rows that do
	// something (open a picker) rather than name a place.
	action?: boolean;
	// Right-click items for the row.
	menu?: ContextMenuItem[];
	onOpen: () => void;
};

// One row shape for everything on this page — disks, the folder picker, and
// recent folders — so they read as the same kind of thing: a place to scan.
const PlaceRow: React.FC<PlaceRowProps> = ({
	icon,
	title,
	detail,
	meta,
	action,
	menu,
	onOpen,
}) => {
	const row = (
		<button
			type="button"
			onClick={onOpen}
			className="group flex w-full cursor-pointer items-center gap-3 px-3 py-[9px] text-left hover:bg-fill"
		>
			<span
				className={`grid h-[32px] w-[32px] flex-shrink-0 place-items-center rounded-button ${
					action
						? "border border-dashed border-faint text-muted group-hover:text-default"
						: "bg-fill text-muted group-hover:bg-fill-strong group-hover:text-default"
				}`}
			>
				{icon}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[13px] font-medium">{title}</span>
				<span className="block truncate text-[11px] text-muted">{detail}</span>
			</span>
			{meta && (
				<span className="flex flex-shrink-0 items-center gap-3 font-mono text-[11px]">
					{meta}
				</span>
			)}
		</button>
	);
	return menu ? <RowMenu items={menu}>{row}</RowMenu> : row;
};

type UsageProps = {
	volume: Ob.DriveUsage | undefined;
	scan: Ob.ScanInfo | undefined;
	// Caption the volume with its free space instead of "used of total":
	// folders use this, disks keep the totals.
	free?: boolean;
};

// How full the volume is, as the OS reports it (no scan needed), with this
// disk's or folder's own scanned size picked out of the used portion once
// there is one. Scans aren't persisted across launches, so that share only
// shows for things scanned since the app started.
const Usage: React.FC<UsageProps> = ({ volume, scan, free }) => {
	const scanned = scan?.status === "complete" ? scan.size : undefined;
	const status =
		scan?.status === "building" ? (
			<span className="text-muted">Scanning…</span>
		) : scanned !== undefined ? (
			<span className="text-default">{readableSize(scanned)}</span>
		) : null;
	if (!volume || volume.total === 0) {
		return status;
	}
	const percent = (bytes: number) =>
		`${Math.min(100, (bytes / volume.total) * 100)}%`;

	return (
		<span className="flex w-[200px] flex-col items-end gap-[6px]">
			<span className="flex gap-[6px]">
				{status}
				{status && <span className="text-faint">·</span>}
				<span className="text-muted">
					{free
						? `${readableSize(volume.available)} free`
						: `${readableSize(volume.used)} of ${readableSize(volume.total)}`}
				</span>
			</span>
			<span className="relative block h-[4px] w-full overflow-hidden rounded-full bg-fill-strong">
				<span
					className="absolute inset-y-0 left-0 rounded-full bg-faint"
					style={{ width: percent(volume.used) }}
				/>
				{scanned !== undefined && (
					// Most folders are a sliver of their volume; keep the
					// share visible even when it rounds to nothing.
					<span
						className="absolute inset-y-0 left-0 min-w-[3px] rounded-full bg-default"
						style={{ width: percent(Math.min(scanned, volume.used)) }}
					/>
				)}
			</span>
		</span>
	);
};

// Dev-only escape hatches for states that are slow or annoying to reach
// naturally: a one-shot "throw from render" to trip the ErrorBoundary, and
// a button that loads a pre-built fake disk so the inspect view can be
// exercised without waiting on a real multi-minute scan. Tree-shaken from
// production builds via the `import.meta.env.DEV` gate at the call site.
const DevTools: React.FC<{ onOpen: (path: string) => void }> = ({ onOpen }) => {
	return (
		<div>
			<div className="mb-2 eyebrow">Dev</div>
			<div className="flex gap-2">
				<Button
					size="small"
					onClick={() => {
						void Ob.devLoadFakeDisk().then(onOpen);
					}}
				>
					Load fake disk
				</Button>
				<ThrowOnClickButton />
			</div>
		</div>
	);
};

// React only catches errors thrown during render, not in event handlers.
// `setState(() => { throw … })` runs the updater during the next render so
// the ErrorBoundary in Application.tsx catches it.
const ThrowOnClickButton: React.FC = () => {
	const [, setBoom] = useState(0);
	return (
		<Button
			size="small"
			onClick={() => {
				setBoom(() => {
					throw new Error("Dev: intentional render error");
				});
			}}
		>
			Throw render error
		</Button>
	);
};
