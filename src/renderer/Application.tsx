import {
	Profiler,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";

import { useNavigation } from "./navigation";
import { perfEnabled, perfLog, perfMeasure } from "./perf";
import { basename } from "./paths";
import {
	useDrives,
	usePasteToScan,
	useRecentScans,
	useScans,
	useTheme,
} from "./state";
import { Cleanup } from "./views/cleanup/Cleanup";
import { DragReceiver } from "./components/DragReceiver";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Inspect } from "./views/inspect/Inspect";
import { PasteConfirm } from "./components/PasteConfirm";
import { ScanFailed } from "./views/inspect/ScanFailed";
import { Scanning } from "./views/inspect/Scanning";
import { ThemeToggle } from "./components/ThemeToggle";
import { Welcome } from "./views/welcome/Welcome";

export const Application: React.FC = () => {
	const drives = useDrives();
	const scans = useScans();
	const {
		recent,
		volumes,
		push: pushRecent,
		remove: removeRecent,
	} = useRecentScans();
	const { theme, toggle: toggleTheme } = useTheme();
	const { view, inspecting, cursor, setInspecting } = useNavigation();
	const inspectingScan = useMemo(
		() =>
			inspecting ? (scans.find((s) => s.path === inspecting) ?? null) : null,
		[inspecting, scans],
	);

	// One entry point that covers both "scan this path" and "open this scan":
	// Ob.scanPath is a no-op for paths already tracked by vfsManager, the
	// recent entry is the same in either case, and the body below picks
	// Scanning vs Inspect based on the live scan status. Recent gets a single
	// stamp at start — no second push when the scan completes. Disks (real
	// or the dev fake) are skipped because they're already pinned to the
	// Disks section; only ad-hoc folder picks belong in the Folders list.
	const onOpen = useCallback(
		(path: string) => {
			void Ob.scanPath(path);
			const isDisk =
				path.startsWith("fake://") || drives.some((d) => d.mountPath === path);
			if (!isDisk) {
				pushRecent(path);
			}
			setInspecting(path);
		},
		[drives, pushRecent, setInspecting],
	);

	// Waits for main to swap in the new scan before navigating, so the old
	// result doesn't flash up first.
	const onRescan = useCallback(
		(path: string) => {
			void Ob.rescanPath(path).then(() => setInspecting(path));
		},
		[setInspecting],
	);

	const paste = usePasteToScan(onOpen);

	// Measure click → painted: nav:start is set inside `navigate`, and we
	// resolve once React has committed the new view. rAF runs after layout
	// so the user-perceived navigation includes paint.
	const cursorKey = cursor.join("/");
	useLayoutEffect(() => {
		if (!perfEnabled()) {
			return;
		}
		const id = requestAnimationFrame(() => perfMeasure("nav", "nav:start"));
		return () => cancelAnimationFrame(id);
	}, [view, inspecting, cursorKey]);

	const handleProfilerRender = useCallback(
		(
			id: string,
			phase: "mount" | "update" | "nested-update",
			actualDuration: number,
		) => {
			if (!perfEnabled()) {
				return;
			}
			if (phase === "mount" || actualDuration > 5) {
				perfLog("react", `${id} ${phase} ${actualDuration.toFixed(1)}ms`);
			}
		},
		[],
	);

	// The window's title, in the title bar and wherever the OS shows it
	// (the taskbar, Alt+Tab): where you are, most specific first, as VS Code
	// has it.
	const scanName = inspecting ? displayName(inspecting, drives) : null;
	const folder = cursor[cursor.length - 1];
	const place = view === "cleanup" ? ["Cleanup review"] : [folder, scanName];
	const title = [...place, "Observatory"].filter(Boolean).join(" — ");
	useEffect(() => {
		document.title = title;
	}, [title]);

	return (
		<div
			id="application"
			className={`relative grid h-screen grid-rows-[36px_1fr] bg-background ${Ob.platform}`}
		>
			<TitleBar title={title} theme={theme} onToggleTheme={toggleTheme} />
			<div className="flex min-h-0 flex-col overflow-hidden">
				<ErrorBoundary key={`${view}-${inspecting ?? "menu"}`}>
					<Profiler id="screen" onRender={handleProfilerRender}>
						<Body
							view={view}
							inspecting={inspecting}
							inspectingScan={inspectingScan}
							drives={drives}
							scans={scans}
							recent={recent}
							volumes={volumes}
							onOpen={onOpen}
							onRescan={onRescan}
							onRemoveRecent={removeRecent}
						/>
					</Profiler>
				</ErrorBoundary>
			</div>
			<PasteConfirm
				open={paste.pastePath !== null}
				path={paste.pastePath}
				stat={paste.pasteStat}
				onCancel={paste.cancel}
				onConfirm={paste.confirm}
			/>
			<DragReceiver onDrop={onOpen} />
		</div>
	);
};

type BodyProps = {
	view: ReturnType<typeof useNavigation>["view"];
	inspecting: string | null;
	inspectingScan: Ob.ScanInfo | null;
	drives: Ob.PhysicalDrive[];
	scans: Ob.ScanInfo[];
	recent: ReturnType<typeof useRecentScans>["recent"];
	volumes: Map<string, Ob.DriveUsage>;
	onOpen: (path: string) => void;
	onRescan: (path: string) => void;
	onRemoveRecent: (path: string) => void;
};

const Body: React.FC<BodyProps> = ({
	view,
	inspecting,
	inspectingScan,
	drives,
	scans,
	recent,
	volumes,
	onOpen,
	onRescan,
	onRemoveRecent,
}) => {
	if (view === "cleanup") {
		return <Cleanup onOpen={onOpen} />;
	}
	if (inspecting && inspectingScan?.status === "complete") {
		return <Inspect scan={inspectingScan} />;
	}
	if (inspecting && inspectingScan?.status === "failed") {
		return (
			<ScanFailed
				scan={inspectingScan}
				root={displayName(inspecting, drives)}
				onRetry={onOpen}
			/>
		);
	}
	if (inspecting && inspectingScan) {
		return (
			<Scanning scan={inspectingScan} root={displayName(inspecting, drives)} />
		);
	}
	return (
		<Welcome
			drives={drives}
			scans={scans}
			recent={recent}
			volumes={volumes}
			onOpen={onOpen}
			onRescan={onRescan}
			onRemoveRecent={onRemoveRecent}
		/>
	);
};

type TitleBarProps = {
	title: string;
	theme: "light" | "dark";
	onToggleTheme: () => void;
};

// The window's only title bar, with the OS's window controls drawn over it:
// the traffic lights at the left on macOS, and minimize / maximize / close
// elsewhere (see titleBarOverlay in src/main/viewManager.ts). Those are at
// the right on Windows, but a Linux desktop can put them at the left, the
// right, or some at each end: they leave this the stretch from
// titlebar-area-x to titlebar-area-x + titlebar-area-width. On macOS those
// aren't set, and the fallbacks leave the whole bar. Off macOS it carries
// the menu too.
const TitleBar: React.FC<TitleBarProps> = ({ title, theme, onToggleTheme }) => {
	const mac = Ob.platform === "darwin";
	useEffect(() => {
		if (!mac) {
			void Ob.setTitleBarTheme(theme);
		}
	}, [mac, theme]);

	return (
		<div
			className="relative flex h-[36px] items-center border-b border-line-soft text-[12px] font-medium text-muted [-webkit-app-region:drag]"
			// The menu starts after any window controls at the left.
			style={{ paddingLeft: "env(titlebar-area-x, 0px)" }}
		>
			{!mac && <AppMenu />}
			<div
				className="pointer-events-none absolute truncate text-center"
				// Centered, and as far in from both ends as the menu has been
				// pushed from the left.
				style={{ insetInline: "calc(260px + env(titlebar-area-x, 0px))" }}
			>
				{title}
			</div>
			<div
				className="absolute top-1/2 -translate-y-1/2 [-webkit-app-region:no-drag]"
				// 10px in from any window controls at the right.
				style={{
					right:
						"calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 10px)",
				}}
			>
				<ThemeToggle theme={theme} onToggle={onToggleTheme} />
			</div>
		</div>
	);
};

// Windows and Linux: the window has no menu bar (see
// src/main/viewManager.ts), so the title bar names the application menu's
// menus, and opens them where you click, as VS Code does. Their shortcuts
// work either way.
const AppMenu: React.FC = () => {
	const [labels, setLabels] = useState<string[]>([]);
	useEffect(() => {
		void Ob.getAppMenu().then(setLabels);
	}, []);

	return (
		<div className="flex h-full items-center pl-[6px] [-webkit-app-region:no-drag]">
			{labels.map((label, i) => (
				<button
					key={label}
					type="button"
					className="h-[26px] cursor-default rounded-button px-[8px] font-normal text-muted hover:bg-fill hover:text-default"
					onClick={(e) => {
						const { left, bottom } = e.currentTarget.getBoundingClientRect();
						void Ob.popupAppMenu(i, left, bottom);
					}}
				>
					{label}
				</button>
			))}
		</div>
	);
};

// Display name for a scan target. Drive paths get the drive description
// ("Macintosh HD"); folder scans get the basename ("Movies", not the full
// path).
function displayName(p: string, drives: Ob.PhysicalDrive[]): string {
	const drive = drives.find((d) => d.mountPath === p);
	return drive ? drive.description : basename(p);
}
