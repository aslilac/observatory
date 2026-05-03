import React, {
	Profiler,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";

import { perfEnabled, perfLog, perfMark, perfMeasure } from "../perf";
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
import { Cleanup } from "./cleanup/Cleanup";
import { CleanupChip } from "./cleanup/CleanupChip";
import { CleanupModal } from "./cleanup/CleanupModal";
import { DragReceiver } from "./DragReceiver";
import { ErrorBoundary } from "./ErrorBoundary";
import { Inspect } from "./inspect/Inspect";
import { IssuesChip } from "./IssuesChip";
import { IssuesModal } from "./IssuesModal";
import { PasteConfirm } from "./PasteConfirm";
import { Scanning } from "./Scanning";
import { ThemeToggle } from "./ThemeToggle";
import { Welcome } from "./welcome/Welcome";

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
		perfMark("nav:start");
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
		(next: string[]) => navigate({ view: "scan", inspecting, cursor: next }),
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

	// Measure click → painted: nav:start is set inside `navigate`, and we
	// resolve once React has actually committed the new view. rAF runs after
	// layout so the user-perceived navigation includes paint.
	const cursorKey = cursor.join("/");
	useLayoutEffect(() => {
		if (!perfEnabled()) return;
		const id = requestAnimationFrame(() => perfMeasure("nav", "nav:start"));
		return () => cancelAnimationFrame(id);
	}, [tree, view, inspecting, cursorKey]);

	const handleProfilerRender = useCallback(
		(
			id: string,
			phase: "mount" | "update" | "nested-update",
			actualDuration: number,
		) => {
			if (!perfEnabled()) return;
			if (phase === "mount" || actualDuration > 5) {
				perfLog("react", `${id} ${phase} ${actualDuration.toFixed(1)}ms`);
			}
		},
		[],
	);

	const scanProgress = useScanProgress(
		inspecting,
		inspectingScan?.status === "building",
	);

	const scanErrors = useScanErrors(inspecting, inspectingScan?.status ?? null);

	const showMenu = useCallback(() => setInspecting(null), [setInspecting]);

	// One entry point that covers both "scan this path" and "open this scan":
	// Ob.scanPath is a no-op for paths already tracked by vfsManager, the
	// recent entry is the same in either case, and Application's body picks
	// Scanning vs Inspect based on the live scan status. Recent gets a single
	// stamp at start — no second push when the scan completes.
	const onOpen = useCallback(
		(path: string) => {
			void Ob.scanPath(path);
			pushRecent(path);
			setInspecting(path);
		},
		[pushRecent, setInspecting],
	);

	const onCancelScan = useCallback(() => {
		if (!inspecting) return;
		void Ob.cancelScan(inspecting);
		setInspecting(null);
	}, [inspecting, setInspecting]);

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

	const confirmPaste = () => {
		if (!pastePath) {
			return;
		}
		onOpen(pastePath);
		setPastePath(null);
		setPasteStat(null);
	};

	const onTrashCleanup = useCallback(
		async (items: typeof cleanup.items) => {
			const sizeByPath = new Map(items.map((i) => [i.path, i.size]));
			const result = await Ob.deleteFiles(items.map((i) => i.path));
			const reclaimed = result.deleted.reduce(
				(sum, p) => sum + (sizeByPath.get(p) ?? 0),
				0,
			);
			for (const p of result.deleted) cleanup.remove(p);
			return {
				deleted: result.deleted.length,
				reclaimed,
				failed: result.failed.length,
			};
		},
		[cleanup],
	);

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
				onCancel={onCancelScan}
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
				onOpen={onOpen}
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
				? tree?.name
				: "";

	return (
		<div
			id="application"
			className={`relative grid h-screen grid-rows-[36px_1fr] bg-paper ${Ob.platform}`}
		>
			<TitleBar title={titleSuffix} theme={theme} onToggleTheme={toggleTheme} />
			<div className="flex min-h-0 flex-col overflow-hidden">
				<ErrorBoundary key={`${view}-${inspecting ?? "menu"}`}>
					<Profiler id="screen" onRender={handleProfilerRender}>
						{body}
					</Profiler>
				</ErrorBoundary>
			</div>
			{confirmCleanup && (
				<CleanupModal
					items={cleanup.items}
					totalSize={cleanup.totalSize}
					onClose={() => setConfirmCleanup(false)}
					onTrash={onTrashCleanup}
				/>
			)}
			{issuesOpen && (
				<IssuesModal errors={scanErrors} onClose={() => setIssuesOpen(false)} />
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
			<DragReceiver onDrop={onOpen} />
		</div>
	);
};

type TitleBarProps = {
	title?: string;
	theme: "light" | "dark";
	onToggleTheme: () => void;
};

const TitleBar: React.FC<TitleBarProps> = ({ title, theme, onToggleTheme }) => (
	<div className="relative flex h-[36px] items-center justify-center border-b border-line-soft text-[12px] font-medium text-muted darwin:[-webkit-app-region:drag]">
		Observatory{title && ` — ${title}`}
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
