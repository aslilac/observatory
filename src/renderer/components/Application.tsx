import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDrives, useRecentScans, useRenderTree, useScans } from "../state";
import { Inspect } from "./Inspect";
import { Scanning } from "./Scanning";
import { Welcome } from "./Welcome";

export const Application = () => {
	const drives = useDrives();
	const scans = useScans();
	const { recent, push: pushRecent } = useRecentScans();
	const [inspecting, setInspecting] = useState<string | null>(null);
	const [cursor, setCursor] = useState<string[]>([]);

	useEffect(() => Ob.onSetInspecting(setInspecting), []);

	useEffect(() => {
		setCursor([]);
	}, [inspecting]);

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

	// Push to recent the moment a scan flips to complete while inspected.
	useEffect(() => {
		if (inspecting && inspectingScan?.status === "complete") {
			pushRecent(inspecting);
		}
	}, [inspecting, inspectingScan?.status, pushRecent]);

	const showMenu = useCallback(() => setInspecting(null), []);

	const onScan = useCallback((path: string) => {
		void Ob.scanPath(path);
		setInspecting(path);
	}, []);

	const onInspect = useCallback((path: string) => {
		setInspecting(path);
	}, []);

	let body: React.ReactNode;
	if (inspecting && inspectingScan?.status === "complete" && tree) {
		body = (
			<Inspect
				tree={tree}
				cursor={cursor}
				setCursor={setCursor}
				onShowMenu={showMenu}
			/>
		);
	} else if (inspecting) {
		body = (
			<Scanning
				root={inspectingScan?.path ?? inspecting}
				onShowMenu={showMenu}
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
			className={`grid h-screen grid-rows-[36px_1fr] bg-paper ${Ob.platform}`}
		>
			<TitleBar title={titleSuffix} />
			<div className="flex min-h-0 flex-col overflow-hidden">{body}</div>
		</div>
	);
};

const TitleBar = ({ title }: { title: string }) => (
	<div className="relative flex h-[36px] items-center border-b border-line-soft bg-paper px-[12px] darwin:[-webkit-app-region:drag]">
		<div className="flex gap-[6px] darwin:[-webkit-app-region:no-drag]">
			<TrafficLight />
			<TrafficLight />
			<TrafficLight />
		</div>
		<div className="absolute inset-x-0 text-center text-[12px] font-medium text-muted">
			Observatory — {title}
		</div>
	</div>
);

const TrafficLight = () => (
	<span className="block h-[11px] w-[11px] rounded-full border border-line bg-fill darwin:bg-faint darwin:border-faint" />
);
