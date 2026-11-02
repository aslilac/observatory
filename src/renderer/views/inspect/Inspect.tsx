import React, { useCallback, useEffect, useMemo, useState } from "react";

import { ListIcon, ListTreeIcon } from "lucide-react";

import { huesByPosition } from "#/colors";
import { useNavigation } from "#/navigation";
import {
	useCleanupQueue,
	useFind,
	useFinderSummaries,
	useRenderTree,
	useScanErrors,
	useScanPerfTree,
} from "#/state";
import { readableSize } from "#/format";
import { joinPath } from "#/paths";
import { IssuesChip } from "#/components/IssuesChip";
import { IssuesModal } from "#/components/IssuesModal";
import { PerfChip } from "#/components/PerfChip";
import { PerfModal } from "#/components/PerfModal";
import { Segmented, Toolbar } from "#/components/Toolbar";
import { CleanupChip } from "../cleanup/CleanupChip";
import { FindBar } from "./FindBar";
import { finderInfo } from "./finders";
import { FindResults } from "./FindResults";
import { FolderTree } from "./FolderTree";
import { LegendList } from "./LegendList";
import { MultiSelectBar } from "./MultiSelectBar";
import { groupReserved } from "./reserved";
import { type SortMode, SortPicker } from "./SortPicker";
import { Sunburst } from "./Sunburst";
import type { SelectableItem } from "./types";

type InspectProps = {
	scan: Ob.ScanInfo;
};

type ViewMode = "list" | "tree";

export const Inspect: React.FC<InspectProps> = ({ scan }) => {
	const inspecting = scan.path;
	const { cursor, setCursor } = useNavigation();
	const { add: addToCleanup } = useCleanupQueue();
	const tree = useRenderTree(inspecting, cursor, scan.status, scan.revision);
	const scanErrors = useScanErrors(inspecting, scan.status);
	const perfTree = useScanPerfTree(inspecting, scan.status, scan.revision);
	const [issuesOpen, setIssuesOpen] = useState(false);
	const [perfOpen, setPerfOpen] = useState(false);
	const [mode, setMode] = useState<ViewMode>("list");
	const [selection, setSelection] = useState<Map<string, SelectableItem>>(
		() => new Map(),
	);
	const [sortMode, setSortMode] = useState<SortMode>("size");
	const [showAll, setShowAll] = useState(false);

	// Find: what a finder finds, or what has a name, in place of the list
	// while there's a query. It looks in the folder that was showing when
	// the query started, and keeps to it while the user goes through the
	// matches in the sunburst.
	const [findText, setFindText] = useState("");
	const [finder, setFinder] = useState<Ob.Finder | null>(null);
	const [findScope, setFindScope] = useState<string[] | null>(null);
	const [suggesting, setSuggesting] = useState(false);
	const scope = findScope ?? cursor;
	const findName = findText.trim();
	const findQuery: Ob.FindQuery | null = findName
		? { name: findName }
		: finder
			? { finder }
			: null;
	const { found, loading: finding } = useFind(
		inspecting,
		scope,
		findQuery,
		scan.revision,
	);
	const summaries = useFinderSummaries(
		inspecting,
		scope,
		suggesting,
		scan.revision,
	);

	const onFindText = (next: string) => {
		setFindText(next);
		if (next.trim()) {
			setFinder(null);
			setFindScope((prev) => prev ?? cursor);
		} else if (!finder) {
			setFindScope(null);
		}
	};
	const pickFinder = (next: Ob.Finder) => {
		setFinder(next);
		setFindText("");
		setFindScope(scope);
		setSuggesting(false);
	};
	const clearFinder = () => {
		setFinder(null);
		setFindScope(null);
	};
	const clearFind = useCallback(() => {
		setFindText("");
		setFinder(null);
		setFindScope(null);
	}, []);

	const onMoveOne = useCallback(
		(item: SelectableItem) => addToCleanup([item]),
		[addToCleanup],
	);

	const onSortChange = useCallback((next: SortMode) => {
		setSortMode(next);
		// Every sort starts collapsed. Size sort shows the top N; the others
		// show everything but what's too small to matter.
		setShowAll(false);
	}, []);

	// Reset on scan switch only — navigating around inside a scan keeps whatever
	// the user has already checked so they can browse for more things to cleanup
	// without losing prior selections.
	useEffect(() => {
		setSelection(new Map());
		clearFind();
		setSortMode("size");
		setShowAll(false);
	}, [inspecting, clearFind]);

	// Each new directory collapses the list again, so a previously-expanded
	// view doesn't follow the user into a child folder.
	const cursorKey = cursor.join("/");
	useEffect(() => {
		setShowAll(false);
	}, [cursorKey]);

	const toggleSelect = useCallback((item: SelectableItem) => {
		setSelection((prev) => {
			const next = new Map(prev);
			if (next.has(item.path)) {
				next.delete(item.path);
			} else {
				next.set(item.path, item);
			}
			return next;
		});
	}, []);

	const cancelSelect = useCallback(() => setSelection(new Map()), []);

	const moveSelectedToCleanup = useCallback(() => {
		addToCleanup(Array.from(selection.values()));
		setSelection(new Map());
	}, [selection, addToCleanup]);

	const selectionTotal = useMemo(
		() => Array.from(selection.values()).reduce((s, i) => s + i.size, 0),
		[selection],
	);

	// Hues for the current directory's children, anchored to the scan root
	// (see colors.ts) so the dot in the legend list and the depth-1 hint in
	// the folder tree match the sunburst wedge, which derives its hues the
	// same way. Computed before the early-return below so the hook is always
	// called.
	const hueByName = useMemo(
		() =>
			huesByPosition(
				tree?.list.files ?? [],
				tree?.position ?? 0,
				tree?.rootSize ?? 0,
			),
		[tree?.list.files, tree?.position, tree?.rootSize],
	);
	const reserved = useMemo(
		() => groupReserved(tree?.reserved ?? []),
		[tree?.reserved],
	);
	const reservedSize = reserved.reduce((sum, g) => sum + g.size, 0);

	const chips = (
		<>
			<IssuesChip errors={scanErrors} onClick={() => setIssuesOpen(true)} />
			<PerfChip
				available={perfTree !== null}
				onClick={() => setPerfOpen(true)}
			/>
			<CleanupChip />
		</>
	);

	if (!tree) {
		return <Toolbar chips={chips} />;
	}

	const navigateForward = (...into: string[]) =>
		setCursor([...cursor, ...into]);
	const navigateUp = () => setCursor(cursor.slice(0, -1));

	const { sunburst, list, tree: treeFiles, ...shared } = tree;
	const treeChildren = treeFiles?.files ?? list.files;
	// `tree.name` is always the scan root (it labels the toolbar crumb); the
	// sidebar header follows the directory the user has navigated into.
	const currentName =
		cursor.length > 0 ? cursor[cursor.length - 1]! : tree.name;
	const scopeName = scope.length > 0 ? scope[scope.length - 1]! : tree.name;

	return (
		<>
			<Toolbar
				root={tree.name}
				right={
					<Segmented<ViewMode>
						value={mode}
						options={[
							{
								value: "list",
								label: "List",
								icon: <ListIcon size={12} strokeWidth={2} />,
							},
							{
								value: "tree",
								label: "Tree",
								icon: <ListTreeIcon size={12} strokeWidth={2} />,
							},
						]}
						onChange={(next) => {
							setMode(next);
							clearFind();
						}}
					/>
				}
				chips={chips}
			/>
			<FindBar
				text={findText}
				onTextChange={onFindText}
				finder={finder}
				onPickFinder={pickFinder}
				onClearFinder={clearFinder}
				onClear={clearFind}
				suggesting={suggesting}
				onSuggestingChange={setSuggesting}
				summaries={summaries}
				named={findName ? found : null}
				scopeName={scopeName}
				right={
					!findQuery && mode === "list" ? (
						<SortPicker value={sortMode} onChange={onSortChange} />
					) : null
				}
			/>
			<div className="flex flex-1 justify-items-stretch overflow-hidden">
				<Sunburst
					files={sunburst.files}
					capacity={shared.capacity}
					size={shared.size}
					position={shared.position}
					rootSize={shared.rootSize}
					reserved={reserved}
					root={inspecting}
					cursor={tree.cursor}
					onNavigateUp={navigateUp}
					onNavigateForward={navigateForward}
					onMoveToCleanup={onMoveOne}
				/>
				<div className="flex w-1/3 max-w-[600px] min-w-[340px] flex-shrink-0 flex-col overflow-auto p-4">
					{findQuery ? (
						<FindResults
							title={
								finder && !findName
									? finderInfo(finder).label
									: `Names with “${findName}”`
							}
							scopeName={scopeName}
							found={found}
							loading={finding}
							showDates={!findName && finder === "old"}
							viewing={joinPath(inspecting, ...cursor)}
							selection={selection}
							onToggleSelect={toggleSelect}
							onMoveToCleanup={addToCleanup}
							onOpen={(within) => setCursor([...scope, ...within])}
							onClose={clearFind}
						/>
					) : mode === "list" ? (
						<LegendList
							inspecting={inspecting}
							cursor={cursor}
							name={currentName}
							size={tree.size}
							capacity={tree.capacity}
							reserved={reserved}
							files={list.files}
							hueByName={hueByName}
							selection={selection}
							onForward={navigateForward}
							onToggleSelect={toggleSelect}
							onMoveToCleanup={onMoveOne}
							sortMode={sortMode}
							showAll={showAll}
							onShowAll={() => setShowAll(true)}
						/>
					) : (
						<FolderTree
							inspecting={inspecting}
							cursor={cursor}
							rootName={currentName}
							files={treeChildren}
							hueByName={hueByName}
							selection={selection}
							onForward={navigateForward}
							onToggleSelect={toggleSelect}
							onMoveToCleanup={onMoveOne}
						/>
					)}
				</div>
			</div>
			{selection.size > 0 ? (
				<MultiSelectBar
					count={selection.size}
					totalSize={selectionTotal}
					onCancel={cancelSelect}
					onMoveToCleanup={moveSelectedToCleanup}
				/>
			) : (
				<div className="flex h-[32px] flex-shrink-0 items-center border-t border-line-soft px-3 text-[11px] text-muted tabular-nums">
					{readableSize(tree.size)}
					{reservedSize > 0 && (
						<>
							<span className="mx-[6px]">·</span>
							{readableSize(reservedSize)} reserved
						</>
					)}
					{tree.capacity !== tree.size && (
						<>
							<span className="mx-[6px]">·</span>
							{readableSize(tree.capacity)} capacity
						</>
					)}
				</div>
			)}
			<IssuesModal
				open={issuesOpen}
				path={inspecting}
				errors={scanErrors}
				onClose={() => setIssuesOpen(false)}
			/>
			<PerfModal
				open={perfOpen && perfTree !== null}
				tree={perfTree}
				onClose={() => setPerfOpen(false)}
			/>
		</>
	);
};
