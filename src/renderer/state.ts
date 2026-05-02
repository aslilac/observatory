import { useEffect, useState } from "react";

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
