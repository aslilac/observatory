import { useCallback, useEffect, useState } from "react";

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
				if (!cancelled) setProgress(next);
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
			if (active) setTree(next);
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
	if (!tail) return base;
	return `${trimmedBase}/${tail}`;
}

export type Theme = "light" | "dark";

const THEME_KEY = "observatory:theme";

function readInitialTheme(): Theme {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === "light" || stored === "dark") return stored;
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
	if (typeof document === "undefined") return;
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
	const [errors, setErrors] = useState<Ob.ScanError[]>([]);

	useEffect(() => {
		if (!path || status !== "complete") {
			setErrors([]);
			return;
		}
		let active = true;
		void Ob.getScanErrors(path).then((next) => {
			if (active) setErrors(next);
		});
		return () => {
			active = false;
		};
	}, [path, status]);

	return errors;
}

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
				if (cancelled) return;
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
	try {
		const raw = localStorage.getItem(RECENT_SCANS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is RecentScan =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as { path?: unknown }).path === "string" &&
				typeof (item as { scannedAt?: unknown }).scannedAt === "number",
		);
	} catch {
		return [];
	}
}

export function useRecentScans(): {
	recent: RecentScan[];
	push: (path: string) => void;
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

	return { recent, push };
}

export type CleanupItem = {
	path: string;
	name: string;
	size: number;
	addedAt: number;
};

const CLEANUP_KEY = "observatory:cleanup-queue";

function readCleanup(): CleanupItem[] {
	try {
		const raw = localStorage.getItem(CLEANUP_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is CleanupItem =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as CleanupItem).path === "string" &&
				typeof (item as CleanupItem).name === "string" &&
				typeof (item as CleanupItem).size === "number" &&
				typeof (item as CleanupItem).addedAt === "number",
		);
	} catch {
		return [];
	}
}

function writeCleanup(items: CleanupItem[]) {
	try {
		localStorage.setItem(CLEANUP_KEY, JSON.stringify(items));
	} catch {
		// localStorage full / unavailable — silently ignore
	}
}

export function useCleanupQueue(): {
	items: CleanupItem[];
	add: (next: Array<Omit<CleanupItem, "addedAt">>) => void;
	remove: (path: string) => void;
	clear: () => void;
	totalSize: number;
} {
	const [items, setItems] = useState<CleanupItem[]>(() => readCleanup());

	const add = useCallback((next: Array<Omit<CleanupItem, "addedAt">>) => {
		setItems((prev) => {
			const seen = new Set(prev.map((i) => i.path));
			const additions = next
				.filter((i) => !seen.has(i.path))
				.map((i) => ({ ...i, addedAt: Date.now() }));
			if (additions.length === 0) return prev;
			const merged = [...prev, ...additions];
			writeCleanup(merged);
			return merged;
		});
	}, []);

	const remove = useCallback((path: string) => {
		setItems((prev) => {
			const next = prev.filter((i) => i.path !== path);
			if (next.length === prev.length) return prev;
			writeCleanup(next);
			return next;
		});
	}, []);

	const clear = useCallback(() => {
		setItems((prev) => {
			if (prev.length === 0) return prev;
			writeCleanup([]);
			return [];
		});
	}, []);

	const totalSize = items.reduce((sum, i) => sum + i.size, 0);

	return { items, add, remove, clear, totalSize };
}
