import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

export function useDrives(): Ob.PhysicalDrive[] {
	const [drives, setDrives] = useState<Ob.PhysicalDrive[]>([]);
	useEffect(() => Ob.onDrives(setDrives), []);
	return drives;
}

export function useScans(): Ob.ScanInfo[] {
	const [scans, setScans] = useState<Ob.ScanInfo[]>([]);
	useEffect(() => Ob.onScans(setScans), []);
	return scans;
}

export function useScanProgress(
	path: string | null,
	active: boolean,
): Ob.ScanProgress | null {
	const [progress, setProgress] = useState<Ob.ScanProgress | null>(null);

	useEffect(() => {
		if (!path || !active) {
			setProgress(null);
			return;
		}
		let cancelled = false;
		const tick = () => {
			void Ob.getScanProgress(path).then((next) => {
				if (!cancelled) {
					setProgress(next);
				}
			});
		};
		tick();
		const id = setInterval(tick, 250);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [path, active]);

	return progress;
}

// One-shot fetch of the perf tree (the live version is delivered via
// useScanProgress while the scan is building; this hook covers the
// post-scan view, where polling would be wasteful). Refetches when the
// scan completes or its revision bumps so cleanup-trash mutations don't
// strand stale data.
export function useScanPerfTree(
	path: string | null,
	status: Ob.ScanStatus | null,
	revision: number | undefined,
): Ob.PerfNode | null {
	return useScanArtifact<Ob.PerfNode | null>(
		path,
		status,
		null,
		(p) => Ob.getScanPerfTree(p),
		[revision],
	);
}

// Shared "fetch this once the scan is complete" pattern: returns `empty`
// while the scan is still building / no path is selected, then resolves to
// whatever the fetcher returns. The active flag drops late responses if the
// scan changes underneath us.
function useScanArtifact<T>(
	path: string | null,
	status: Ob.ScanStatus | null,
	empty: T,
	fetcher: (path: string) => Promise<T>,
	extraDeps: React.DependencyList = [],
): T {
	const [value, setValue] = useState<T>(empty);

	useEffect(() => {
		if (!path || status !== "complete") {
			setValue(empty);
			return;
		}
		let active = true;
		void fetcher(path).then((next) => {
			if (active) {
				setValue(next);
			}
		});
		return () => {
			active = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes extraDeps explicitly
	}, [path, status, ...extraDeps]);

	return value;
}

export function useRenderTree(
	path: string | null,
	cursor: string[],
	status: Ob.ScanStatus | null,
	revision: number | undefined,
): Ob.RenderTree | null {
	const [tree, setTree] = useState<Ob.RenderTree | null>(null);
	const cursorKey = cursor.join("/");

	useEffect(() => {
		if (!path || status !== "complete") {
			setTree(null);
			return;
		}
		let active = true;
		void Ob.getRenderTree(path, cursor).then((next) => {
			if (active) {
				setTree(next);
			}
		});
		return () => {
			active = false;
		};
	}, [path, cursorKey, status, revision]);

	return tree;
}

// Renderer-side path join. We never see Windows paths in this app (the
// scan roots come from drivelist or a POSIX dialog on Linux/macOS), so
// forward slashes and a couple of normalizations are enough.
export function joinPath(base: string, ...rest: string[]): string {
	const trimmedBase = base === "/" ? "" : base.replace(/\/+$/, "");
	const tail = rest
		.filter((p) => p.length > 0)
		.map((p) => p.replace(/^\/+|\/+$/g, ""))
		.filter((p) => p.length > 0)
		.join("/");
	if (!tail) {
		return base;
	}
	return `${trimmedBase}/${tail}`;
}

export type Theme = "light" | "dark";

const THEME_KEY = "observatory:theme";

function readInitialTheme(): Theme {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === "light" || stored === "dark") {
			return stored;
		}
	} catch {
		// localStorage unavailable
	}
	if (
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-color-scheme: dark)").matches
	) {
		return "dark";
	}
	return "light";
}

function applyTheme(theme: Theme) {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme(): { theme: Theme; toggle: () => void } {
	const [theme, setTheme] = useState<Theme>(() => {
		const initial = readInitialTheme();
		applyTheme(initial);
		return initial;
	});

	const toggle = useCallback(() => {
		setTheme((prev) => {
			const next: Theme = prev === "dark" ? "light" : "dark";
			applyTheme(next);
			try {
				localStorage.setItem(THEME_KEY, next);
			} catch {
				// localStorage full / unavailable
			}
			return next;
		});
	}, []);

	return { theme, toggle };
}

export function useScanErrors(
	path: string | null,
	status: Ob.ScanStatus | null,
): Ob.ScanError[] {
	return useScanArtifact<Ob.ScanError[]>(path, status, EMPTY_ERRORS, (p) =>
		Ob.getScanErrors(p),
	);
}

// Stable reference so useScanArtifact's empty-state set doesn't cause
// downstream consumers to see a "new" array each render.
const EMPTY_ERRORS: Ob.ScanError[] = [];

export function useSearch(
	path: string | null,
	query: string,
): { results: Ob.SearchResults | null; loading: boolean } {
	const [results, setResults] = useState<Ob.SearchResults | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const trimmed = query.trim();
		if (!path || !trimmed) {
			setResults(null);
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		const id = setTimeout(() => {
			void Ob.searchScan(path, trimmed).then((next) => {
				if (cancelled) {
					return;
				}
				setResults(next);
				setLoading(false);
			});
		}, 180);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [path, query]);

	return { results, loading };
}

export type RecentScan = {
	path: string;
	scannedAt: number;
};

const RECENT_SCANS_KEY = "observatory:recent-scans";
const RECENT_SCANS_MAX = 10;

function readRecentScans(): RecentScan[] {
	return readJsonArray<RecentScan>(
		RECENT_SCANS_KEY,
		(item): item is RecentScan =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as { path?: unknown }).path === "string" &&
			typeof (item as { scannedAt?: unknown }).scannedAt === "number",
	);
}

// Read & validate an array stored in localStorage. Anything that isn't valid
// JSON, isn't an array, or fails the per-item guard becomes an empty list —
// localStorage is best-effort and we never want a malformed entry to crash
// the app on boot.
function readJsonArray<T>(key: string, isItem: (v: unknown) => v is T): T[] {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) {
			return [];
		}
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter(isItem);
	} catch {
		return [];
	}
}

export function useRecentScans(): {
	recent: RecentScan[];
	push: (path: string) => void;
	remove: (path: string) => void;
} {
	const [recent, setRecent] = useState<RecentScan[]>(() => readRecentScans());

	// Mirror the list to main so it can populate the File → Open Recent
	// submenu. The renderer is still the source of truth (localStorage); main
	// just rebuilds its menu around whatever we publish.
	useEffect(() => {
		void Ob.publishRecentScans(recent);
	}, [recent]);

	const push = useCallback((path: string) => {
		setRecent((prev) => {
			const next = [
				{ path, scannedAt: Date.now() },
				...prev.filter((entry) => entry.path !== path),
			].slice(0, RECENT_SCANS_MAX);
			try {
				localStorage.setItem(RECENT_SCANS_KEY, JSON.stringify(next));
			} catch {
				// localStorage full / unavailable — silently ignore
			}
			return next;
		});
	}, []);

	const remove = useCallback((path: string) => {
		setRecent((prev) => {
			const next = prev.filter((entry) => entry.path !== path);
			try {
				localStorage.setItem(RECENT_SCANS_KEY, JSON.stringify(next));
			} catch {
				// localStorage full / unavailable — silently ignore
			}
			return next;
		});
	}, []);

	return { recent, push, remove };
}

export type CleanupItem = {
	path: string;
	name: string;
	size: number;
	addedAt: number;
};

const CLEANUP_KEY = "observatory:cleanup-queue";

function readCleanup(): CleanupItem[] {
	return readJsonArray<CleanupItem>(
		CLEANUP_KEY,
		(item): item is CleanupItem =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as CleanupItem).path === "string" &&
			typeof (item as CleanupItem).name === "string" &&
			typeof (item as CleanupItem).size === "number" &&
			typeof (item as CleanupItem).addedAt === "number",
	);
}

function writeCleanup(items: CleanupItem[]) {
	try {
		localStorage.setItem(CLEANUP_KEY, JSON.stringify(items));
	} catch {
		// localStorage full / unavailable — silently ignore
	}
}

type CleanupQueue = {
	items: CleanupItem[];
	add: (next: Array<Omit<CleanupItem, "addedAt">>) => void;
	remove: (path: string) => void;
	clear: () => void;
	totalSize: number;
};

const CleanupQueueContext = createContext<CleanupQueue | null>(null);

// Cleanup queue lives in a provider so each view can subscribe independently:
// the CleanupChip in any toolbar, the Inspect view's "add to cleanup", and
// the Cleanup view itself all share one store without props plumbing.
export const CleanupQueueProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [items, setItems] = useState<CleanupItem[]>(() => readCleanup());

	const add = useCallback((next: Array<Omit<CleanupItem, "addedAt">>) => {
		setItems((prev) => {
			const seen = new Set(prev.map((i) => i.path));
			const additions = next
				.filter((i) => !seen.has(i.path))
				.map((i) => ({ ...i, addedAt: Date.now() }));
			if (additions.length === 0) {
				return prev;
			}
			const merged = [...prev, ...additions];
			writeCleanup(merged);
			return merged;
		});
	}, []);

	const remove = useCallback((path: string) => {
		setItems((prev) => {
			const next = prev.filter((i) => i.path !== path);
			if (next.length === prev.length) {
				return prev;
			}
			writeCleanup(next);
			return next;
		});
	}, []);

	const clear = useCallback(() => {
		setItems((prev) => {
			if (prev.length === 0) {
				return prev;
			}
			writeCleanup([]);
			return [];
		});
	}, []);

	const totalSize = items.reduce((sum, i) => sum + i.size, 0);

	const value = useMemo<CleanupQueue>(
		() => ({ items, add, remove, clear, totalSize }),
		[items, add, remove, clear, totalSize],
	);

	return (
		<CleanupQueueContext.Provider value={value}>
			{children}
		</CleanupQueueContext.Provider>
	);
};

export function useCleanupQueue(): CleanupQueue {
	const ctx = useContext(CleanupQueueContext);
	if (!ctx) {
		throw new Error(
			"useCleanupQueue must be used inside a CleanupQueueProvider",
		);
	}
	return ctx;
}

// Listens for absolute-looking paths pasted anywhere outside of inputs.
// Wrap the returned state into a <PasteConfirm> for the modal flow.
export function usePasteToScan(onOpen: (path: string) => void): {
	pastePath: string | null;
	pasteStat: Ob.PathStat | null;
	cancel: () => void;
	confirm: () => void;
} {
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
			if (!text) {
				return;
			}
			// Heuristic: a pasted scan target should look like an absolute path.
			// Anything else (URLs, snippets) gets ignored so the global handler
			// stays out of the user's way.
			if (!/^([/~]|[A-Za-z]:[\\/])/.test(text)) {
				return;
			}
			e.preventDefault();
			setPastePath(text);
			setPasteStat(null);
			void Ob.statPath(text).then(setPasteStat);
		};
		document.addEventListener("paste", handler);
		return () => document.removeEventListener("paste", handler);
	}, []);

	const cancel = useCallback(() => {
		setPastePath(null);
		setPasteStat(null);
	}, []);

	const confirm = useCallback(() => {
		if (!pastePath) {
			return;
		}
		onOpen(pastePath);
		setPastePath(null);
		setPasteStat(null);
	}, [pastePath, onOpen]);

	return { pastePath, pasteStat, cancel, confirm };
}
