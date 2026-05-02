import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	useCleanupQueue,
	useDrives,
	useRecentScans,
	useRenderTree,
	useScanErrors,
	useScanProgress,
	useScans,
	useTheme,
} from "../state";
import { Cleanup } from "./Cleanup";
import { CleanupChip } from "./CleanupChip";
import { CleanupModal } from "./CleanupModal";
import { DropOverlay } from "./DropOverlay";
import { Inspect } from "./Inspect";
import { IssuesChip } from "./IssuesChip";
import { IssuesModal } from "./IssuesModal";
import { PasteConfirm } from "./PasteConfirm";
import { Scanning } from "./Scanning";
import { ThemeToggle } from "./ThemeToggle";
import { Welcome } from "./Welcome";

type NavView = "scan" | "cleanup";
type NavEntry = {
	view: NavView;
	inspecting: string | null;
	cursor: string[];
};
type NavState = { history: NavEntry[]; index: number };

const sameCursor = (a: string[], b: string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

const sameEntry = (a: NavEntry, b: NavEntry) =>
	a.view === b.view &&
	a.inspecting === b.inspecting &&
	sameCursor(a.cursor, b.cursor);

export const Application = () => {
	const drives = useDrives();
	const scans = useScans();
	const { recent, push: pushRecent } = useRecentScans();
	const cleanup = useCleanupQueue();
	const [confirmCleanup, setConfirmCleanup] = useState(false);
	const [issuesOpen, setIssuesOpen] = useState(false);
	const { theme, toggle: toggleTheme } = useTheme();

	const [nav, setNav] = useState<NavState>({
		history: [{ view: "scan", inspecting: null, cursor: [] }],
		index: 0,
	});
	const current = nav.history[nav.index]!;
	const { view, inspecting, cursor } = current;

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
		(path: string | null) =>
			navigate({ view: "scan", inspecting: path, cursor: [] }),
		[navigate],
	);

	const setCursor = useCallback(
		(next: string[]) =>
			navigate({ view: "scan", inspecting, cursor: next }),
		[navigate, inspecting],
	);

	const showCleanup = useCallback(
		() =>
			navigate({
				view: "cleanup",
				inspecting,
				cursor,
			}),
		[navigate, inspecting, cursor],
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

	const scanErrors = useScanErrors(inspecting, inspectingScan?.status ?? null);

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

	const [dragOver, setDragOver] = useState(false);
	const dragCounter = useRef(0);

	const handleDragEnter = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes("Files")) return;
		e.preventDefault();
		dragCounter.current += 1;
		setDragOver(true);
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes("Files")) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes("Files")) return;
		dragCounter.current = Math.max(0, dragCounter.current - 1);
		if (dragCounter.current === 0) setDragOver(false);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			if (!e.dataTransfer.types.includes("Files")) return;
			e.preventDefault();
			dragCounter.current = 0;
			setDragOver(false);
			const file = e.dataTransfer.files[0];
			if (!file) return;
			const path = Ob.pathForFile(file);
			if (path) onScan(path);
		},
		[onScan],
	);

	const [pastePath, setPastePath] = useState<string | null>(null);
	const [pasteStat, setPasteStat] = useState<Ob.PathStat | null>(null);

	useEffect(() => {
		const handler = (e: ClipboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}
			const text = e.clipboardData?.getData("text/plain")?.trim();
			if (!text) return;
			// Heuristic: a pasted scan target should look like an absolute path.
			// Anything else (URLs, snippets) gets ignored so the global handler
			// stays out of the user's way.
			if (!/^([/~]|[A-Za-z]:[\\/])/.test(text)) return;
			e.preventDefault();
			setPastePath(text);
			setPasteStat(null);
			void Ob.statPath(text).then(setPasteStat);
		};
		document.addEventListener("paste", handler);
		return () => document.removeEventListener("paste", handler);
	}, []);

	const confirmPaste = useCallback(() => {
		if (!pastePath) return;
		onScan(pastePath);
		setPastePath(null);
		setPasteStat(null);
	}, [pastePath, onScan]);

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

	const chips = (
		<>
			<IssuesChip
				count={scanErrors.length}
				onClick={() => setIssuesOpen(true)}
			/>
			<CleanupChip
				count={cleanup.items.length}
				totalSize={cleanup.totalSize}
				onClick={showCleanup}
			/>
		</>
	);

	const navProps = {
		canBack,
		canForward,
		onBack: goBack,
		onForward: goForward,
	};

	const inspectingName = inspecting ? displayName(inspecting, drives) : "";

	let body: React.ReactNode;
	if (view === "cleanup") {
		body = (
			<Cleanup
				items={cleanup.items}
				totalSize={cleanup.totalSize}
				onRemove={cleanup.remove}
				onClear={cleanup.clear}
				onReview={() => setConfirmCleanup(true)}
				onShowMenu={showMenu}
				onBrowseFiles={() => void Ob.selectDirectory()}
				chips={chips}
				{...navProps}
			/>
		);
	} else if (inspecting && inspectingScan?.status === "complete" && tree) {
		body = (
			<Inspect
				inspecting={inspecting}
				tree={tree}
				cursor={cursor}
				setCursor={setCursor}
				onShowMenu={showMenu}
				chips={chips}
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
				chips={chips}
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
				chips={chips}
				{...navProps}
			/>
		);
	}

	const titleSuffix =
		view === "cleanup"
			? `cleanup queue · ${
					cleanup.items.length === 0 ? "empty" : `${cleanup.items.length} items`
				}`
			: inspecting
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
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<TitleBar
				title={titleSuffix}
				theme={theme}
				onToggleTheme={toggleTheme}
			/>
			<div className="flex min-h-0 flex-col overflow-hidden">{body}</div>
			{confirmCleanup && (
				<CleanupModal
					items={cleanup.items}
					totalSize={cleanup.totalSize}
					onClose={() => setConfirmCleanup(false)}
					onTrash={onTrashCleanup}
				/>
			)}
			{issuesOpen && (
				<IssuesModal
					errors={scanErrors}
					onClose={() => setIssuesOpen(false)}
				/>
			)}
			{pastePath && (
				<PasteConfirm
					path={pastePath}
					stat={pasteStat}
					onCancel={() => {
						setPastePath(null);
						setPasteStat(null);
					}}
					onConfirm={confirmPaste}
				/>
			)}
			{dragOver && <DropOverlay />}
		</div>
	);
};

const TitleBar = ({
	title,
	theme,
	onToggleTheme,
}: {
	title: string;
	theme: "light" | "dark";
	onToggleTheme: () => void;
}) => (
	<div className="relative flex h-[36px] items-center justify-center border-b border-line-soft bg-paper text-[12px] font-medium text-muted darwin:[-webkit-app-region:drag]">
		Observatory — {title}
		<div className="absolute top-1/2 right-[10px] -translate-y-1/2">
			<ThemeToggle theme={theme} onToggle={onToggleTheme} />
		</div>
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
