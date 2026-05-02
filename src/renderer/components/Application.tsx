import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
	useCleanupQueue,
	useDrives,
	useRecentScans,
	useRenderTree,
	useScanProgress,
	useScans,
} from "../state";
import { CleanupChip } from "./CleanupChip";
import { CleanupModal } from "./CleanupModal";
import { Inspect } from "./Inspect";
import { Scanning } from "./Scanning";
import { Welcome } from "./Welcome";

type NavEntry = { inspecting: string | null; cursor: string[] };
type NavState = { history: NavEntry[]; index: number };

const sameCursor = (a: string[], b: string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

const sameEntry = (a: NavEntry, b: NavEntry) =>
	a.inspecting === b.inspecting && sameCursor(a.cursor, b.cursor);

export const Application = () => {
	const drives = useDrives();
	const scans = useScans();
	const { recent, push: pushRecent } = useRecentScans();
	const cleanup = useCleanupQueue();
	const [cleanupOpen, setCleanupOpen] = useState(false);

	const [nav, setNav] = useState<NavState>({
		history: [{ inspecting: null, cursor: [] }],
		index: 0,
	});
	const current = nav.history[nav.index]!;
	const { inspecting, cursor } = current;

	const navigate = useCallback((entry: NavEntry) => {
		setNav((prev) => {
			const truncated = prev.history.slice(0, prev.index + 1);
			const last = truncated[truncated.length - 1]!;
			if (sameEntry(last, entry)) return prev;
			return {
				history: [...truncated, entry],
				index: truncated.length,
			};
		});
	}, []);

	const goBack = useCallback(() => {
		setNav((prev) =>
			prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev,
		);
	}, []);

	const goForward = useCallback(() => {
		setNav((prev) =>
			prev.index < prev.history.length - 1
				? { ...prev, index: prev.index + 1 }
				: prev,
		);
	}, []);

	const canBack = nav.index > 0;
	const canForward = nav.index < nav.history.length - 1;

	const setInspecting = useCallback(
		(path: string | null) => navigate({ inspecting: path, cursor: [] }),
		[navigate],
	);

	const setCursor = useCallback(
		(next: string[]) => navigate({ inspecting, cursor: next }),
		[navigate, inspecting],
	);

	useEffect(() => Ob.onSetInspecting(setInspecting), [setInspecting]);

	useEffect(
		() =>
			Ob.onNav((direction) => {
				if (direction === "back") goBack();
				else goForward();
			}),
		[goBack, goForward],
	);

	const inspectingScan = useMemo(
		() =>
			inspecting ? (scans.find((s) => s.path === inspecting) ?? null) : null,
		[inspecting, scans],
	);

	const tree = useRenderTree(
		inspecting,
		cursor,
		inspectingScan?.status ?? null,
	);

	const scanProgress = useScanProgress(
		inspecting,
		inspectingScan?.status === "building",
	);

	useEffect(() => {
		if (inspecting && inspectingScan?.status === "complete") {
			pushRecent(inspecting);
		}
	}, [inspecting, inspectingScan?.status, pushRecent]);

	const showMenu = useCallback(() => setInspecting(null), [setInspecting]);

	const onScan = useCallback(
		(path: string) => {
			void Ob.scanPath(path);
			setInspecting(path);
		},
		[setInspecting],
	);

	const onInspect = useCallback(
		(path: string) => setInspecting(path),
		[setInspecting],
	);

	const onTrashCleanup = useCallback(async () => {
		const queued = cleanup.items;
		const sizeByPath = new Map(queued.map((i) => [i.path, i.size]));
		const result = await Ob.deleteFiles(queued.map((i) => i.path));
		const reclaimed = result.deleted.reduce(
			(sum, p) => sum + (sizeByPath.get(p) ?? 0),
			0,
		);
		result.deleted.forEach((p) => cleanup.remove(p));
		return {
			deleted: result.deleted.length,
			reclaimed,
			failed: result.failed.length,
		};
	}, [cleanup]);

	const cleanupChip = (
		<CleanupChip
			count={cleanup.items.length}
			totalSize={cleanup.totalSize}
			onClick={() => setCleanupOpen(true)}
		/>
	);

	const navProps = {
		canBack,
		canForward,
		onBack: goBack,
		onForward: goForward,
	};

	const inspectingName = inspecting ? displayName(inspecting, drives) : "";

	let body: React.ReactNode;
	if (inspecting && inspectingScan?.status === "complete" && tree) {
		body = (
			<Inspect
				inspecting={inspecting}
				tree={tree}
				cursor={cursor}
				setCursor={setCursor}
				onShowMenu={showMenu}
				cleanupChip={cleanupChip}
				onAddToCleanup={cleanup.add}
				{...navProps}
			/>
		);
	} else if (inspecting) {
		body = (
			<Scanning
				root={inspectingName}
				progress={scanProgress}
				onShowMenu={showMenu}
				cleanupChip={cleanupChip}
				{...navProps}
			/>
		);
	} else {
		body = (
			<Welcome
				drives={drives}
				scans={scans}
				recent={recent}
				onScan={onScan}
				onInspect={onInspect}
				cleanupChip={cleanupChip}
				{...navProps}
			/>
		);
	}

	const titleSuffix = inspecting
		? inspectingScan?.status === "complete"
			? cursor.length > 0
				? `inspect · ${cursor[cursor.length - 1]}`
				: "inspect"
			: "scanning"
		: "welcome";

	return (
		<div
			id="application"
			className={`relative grid h-screen grid-rows-[36px_1fr] bg-paper ${Ob.platform}`}
		>
			<TitleBar title={titleSuffix} />
			<div className="flex min-h-0 flex-col overflow-hidden">{body}</div>
			{cleanupOpen && (
				<CleanupModal
					items={cleanup.items}
					totalSize={cleanup.totalSize}
					onClose={() => setCleanupOpen(false)}
					onRemove={cleanup.remove}
					onTrash={onTrashCleanup}
				/>
			)}
		</div>
	);
};

const TitleBar = ({ title }: { title: string }) => (
	<div className="relative flex h-[36px] items-center justify-center border-b border-line-soft bg-paper text-[12px] font-medium text-muted darwin:[-webkit-app-region:drag]">
		Observatory — {title}
	</div>
);

// Display name for a scan target. Drive paths get the drive description
// ("Macintosh HD"); folder scans get the basename ("Movies", not the full
// path).
function displayName(p: string, drives: Ob.PhysicalDrive[]): string {
	const drive = drives.find((d) => d.mountPath === p);
	if (drive) return drive.description;
	const trimmed = p.replace(/[/\\]+$/, "") || p;
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return slash >= 0 ? trimmed.slice(slash + 1) || trimmed : trimmed;
}
