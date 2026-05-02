import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useDrives, useRecentScans, useRenderTree, useScans } from "../state";
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

	const navProps = {
		canBack,
		canForward,
		onBack: goBack,
		onForward: goForward,
	};

	let body: React.ReactNode;
	if (inspecting && inspectingScan?.status === "complete" && tree) {
		body = (
			<Inspect
				tree={tree}
				cursor={cursor}
				setCursor={setCursor}
				onShowMenu={showMenu}
				{...navProps}
			/>
		);
	} else if (inspecting) {
		body = (
			<Scanning
				root={inspectingScan?.path ?? inspecting}
				onShowMenu={showMenu}
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
