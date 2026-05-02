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

export function useRenderTree(
	path: string | null,
	cursor: string[],
	status: Ob.ScanStatus | null,
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
	}, [path, cursorKey, status]);

	return tree;
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
