import { Profiler, useCallback, useLayoutEffect, useMemo } from "react";

import { useNavigation } from "./navigation";
import { perfEnabled, perfLog, perfMeasure } from "./perf";
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
import { Scanning } from "./views/inspect/Scanning";
import { ThemeToggle } from "./components/ThemeToggle";
import { Welcome } from "./views/welcome/Welcome";

export const Application: React.FC = () => {
	const drives = useDrives();
	const scans = useScans();
	const { recent, push: pushRecent } = useRecentScans();
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
	// stamp at start — no second push when the scan completes.
	const onOpen = useCallback(
		(path: string) => {
			void Ob.scanPath(path);
			pushRecent(path);
			setInspecting(path);
		},
		[pushRecent, setInspecting],
	);

	const paste = usePasteToScan(onOpen);

	// Measure click → painted: nav:start is set inside `navigate`, and we
	// resolve once React has committed the new view. rAF runs after layout
	// so the user-perceived navigation includes paint.
	const cursorKey = cursor.join("/");
	useLayoutEffect(() => {
		if (!perfEnabled()) return;
		const id = requestAnimationFrame(() => perfMeasure("nav", "nav:start"));
		return () => cancelAnimationFrame(id);
	}, [view, inspecting, cursorKey]);

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

	const titleSuffix =
		view === "cleanup"
			? "cleanup review"
			: inspecting
				? displayName(inspecting, drives)
				: "";

	return (
		<div
			id="application"
			className={`relative grid h-screen grid-rows-[36px_1fr] bg-background ${Ob.platform}`}
		>
			<TitleBar title={titleSuffix} theme={theme} onToggleTheme={toggleTheme} />
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
							onOpen={onOpen}
						/>
					</Profiler>
				</ErrorBoundary>
			</div>
			{paste.pastePath && (
				<PasteConfirm
					path={paste.pastePath}
					stat={paste.pasteStat}
					onCancel={paste.cancel}
					onConfirm={paste.confirm}
				/>
			)}
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
	onOpen: (path: string) => void;
};

const Body: React.FC<BodyProps> = ({
	view,
	inspecting,
	inspectingScan,
	drives,
	scans,
	recent,
	onOpen,
}) => {
	if (view === "cleanup") return <Cleanup />;
	if (inspecting && inspectingScan?.status === "complete") {
		return <Inspect scan={inspectingScan} />;
	}
	if (inspecting && inspectingScan) {
		return (
			<Scanning scan={inspectingScan} root={displayName(inspecting, drives)} />
		);
	}
	return (
		<Welcome drives={drives} scans={scans} recent={recent} onOpen={onOpen} />
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
		<div className="absolute top-1/2 right-[10px] -translate-y-1/2 darwin:[-webkit-app-region:no-drag]">
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
