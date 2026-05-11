import React, { useCallback, useEffect, useMemo, useState } from "react";

import { huesByPosition } from "../../colors";
import { useNavigation } from "../../navigation";
import {
	useCleanupQueue,
	useRenderTree,
	useScanErrors,
	useScanPerfTree,
	useSearch,
} from "../../state";
import { readableSize } from "../../util";
import { IssuesChip } from "../../components/IssuesChip";
import { IssuesModal } from "../../components/IssuesModal";
import { PerfChip } from "../../components/PerfChip";
import { PerfModal } from "../../components/PerfModal";
import { Segmented, Toolbar } from "../../components/Toolbar";
import { CleanupChip } from "../cleanup/CleanupChip";
import { FolderTree } from "./FolderTree";
import { LegendList } from "./LegendList";
import { MultiSelectBar } from "./MultiSelectBar";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";
import { type SortMode, SortPicker } from "./SortPicker";
import { Sunburst } from "./Sunburst";

type SelectableItem = { path: string; name: string; size: number };

const ListIcon: React.FC = () => (
	<svg
		width="12"
		height="12"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<line x1="8" y1="6" x2="21" y2="6" />
		<line x1="8" y1="12" x2="21" y2="12" />
		<line x1="8" y1="18" x2="21" y2="18" />
		<line x1="3" y1="6" x2="3.01" y2="6" />
		<line x1="3" y1="12" x2="3.01" y2="12" />
		<line x1="3" y1="18" x2="3.01" y2="18" />
	</svg>
);

const TreeIcon: React.FC = () => (
	<svg
		width="12"
		height="12"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M5 4v6a2 2 0 0 0 2 2h12" />
		<path d="M9 12v6a2 2 0 0 0 2 2h8" />
		<circle cx="5" cy="4" r="0.5" fill="currentColor" />
	</svg>
);

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
	const [query, setQuery] = useState("");
	const [sortMode, setSortMode] = useState<SortMode>("size");
	const [showAll, setShowAll] = useState(false);
	const { results: searchResults, loading: searching } = useSearch(
		inspecting,
		query,
	);
	const searchActive = query.trim().length > 0;

	const onAddOne = useCallback(
		(item: SelectableItem) => addToCleanup([item]),
		[addToCleanup],
	);

	const onSortChange = useCallback((next: SortMode) => {
		setSortMode(next);
		// Non-default sorts are usually intentional searches for an item by
		// name or recency, so expand by default; flipping back to size collapses
		// to the top-N view again.
		setShowAll(next !== "size");
	}, []);

	// Reset on scan switch only — navigating around inside a scan keeps whatever
	// the user has already checked so they can browse for more things to cleanup
	// without losing prior selections.
	useEffect(() => {
		setSelection(new Map());
		setQuery("");
		setSortMode("size");
		setShowAll(false);
	}, [inspecting]);

	// Each new directory collapses the list back to top-N for size-sort so a
	// previously-expanded view doesn't follow the user into a child folder.
	// Non-size sorts stay expanded — a partial alphabetical or recency view would
	// just be confusing.
	const cursorKey = cursor.join("/");
	const sortModeRef = React.useRef(sortMode);
	sortModeRef.current = sortMode;
	useEffect(() => {
		setShowAll(sortModeRef.current !== "size");
	}, [cursorKey]);

	const toggleSelect = useCallback((item: SelectableItem) => {
		setSelection((prev) => {
			const next = new Map(prev);
			if (next.has(item.path)) next.delete(item.path);
			else next.set(item.path, item);
			return next;
		});
	}, []);

	const cancelSelect = useCallback(() => setSelection(new Map()), []);

	const addSelectedToCleanup = useCallback(() => {
		const items = Array.from(selection.values()).map((i) => ({
			path: i.path,
			name: i.name,
			size: i.size,
		}));
		addToCleanup(items);
		setSelection(new Map());
	}, [selection, addToCleanup]);

	const selectionTotal = useMemo(
		() => Array.from(selection.values()).reduce((s, i) => s + i.size, 0),
		[selection],
	);

	if (!tree) {
		return (
			<Toolbar
				chips={
					<>
						<IssuesChip
							count={scanErrors.length}
							onClick={() => setIssuesOpen(true)}
						/>
						<PerfChip
							available={perfTree !== null}
							onClick={() => setPerfOpen(true)}
						/>
						<CleanupChip />
					</>
				}
			/>
		);
	}

	const navigateForward = (...into: string[]) =>
		setCursor([...cursor, ...into]);
	const navigateUp = () => setCursor(cursor.slice(0, -1));

	const { sunburst, list, tree: treeFiles, ...shared } = tree;
	const treeChildren = treeFiles?.files ?? list.files;
	// Single source of truth for top-level hues so the dot in the legend list,
	// the depth-1 hint in the folder tree, and the wedge in the sunburst all
	// agree. Built from the size-desc list so the rainbow lays itself out
	// proportionally to byte share.
	const hueByName = useMemo(() => huesByPosition(list.files), [list.files]);

	return (
		<>
			<Toolbar
				root={tree.name}
				right={
					<Segmented<ViewMode>
						value={mode}
						options={[
							{ value: "list", label: "List", icon: <ListIcon /> },
							{ value: "tree", label: "Tree", icon: <TreeIcon /> },
						]}
						onChange={setMode}
					/>
				}
				chips={
					<>
						<IssuesChip
							count={scanErrors.length}
							onClick={() => setIssuesOpen(true)}
						/>
						<PerfChip
							available={perfTree !== null}
							onClick={() => setPerfOpen(true)}
						/>
						<CleanupChip />
					</>
				}
			/>
			<SearchBar
				query={query}
				onQueryChange={setQuery}
				matchCount={searchResults?.totalCount ?? null}
				loading={searching}
				right={
					!searchActive && mode === "list" ? (
						<SortPicker value={sortMode} onChange={onSortChange} />
					) : null
				}
			/>
			<div className="flex flex-1 overflow-hidden justify-items-stretch">
				<Sunburst
					files={sunburst.files}
					capacity={shared.capacity}
					size={shared.size}
					position={shared.position}
					rootSize={shared.rootSize}
					hueByName={hueByName}
					onNavigateUp={navigateUp}
					onNavigateForward={navigateForward}
				/>
				<div className="flex w-1/3 max-w-[600px] flex-col p-4 overflow-auto">
					{searchActive ? (
						<SearchResults
							results={searchResults}
							loading={searching}
							query={query}
							selection={selection}
							onToggleSelect={toggleSelect}
							onAddToCleanup={onAddOne}
						/>
					) : mode === "list" ? (
						<LegendList
							inspecting={inspecting}
							cursor={cursor}
							name={tree.name}
							size={tree.size}
							capacity={tree.capacity}
							files={list.files}
							hueByName={hueByName}
							selection={selection}
							onForward={navigateForward}
							onToggleSelect={toggleSelect}
							onAddToCleanup={onAddOne}
							sortMode={sortMode}
							showAll={showAll}
							onShowAll={() => setShowAll(true)}
						/>
					) : (
						<FolderTree
							inspecting={inspecting}
							cursor={cursor}
							rootName={
								cursor.length > 0 ? cursor[cursor.length - 1]! : tree.name
							}
							files={treeChildren}
							hueByName={hueByName}
							selection={selection}
							onForward={navigateForward}
							onToggleSelect={toggleSelect}
							onAddToCleanup={onAddOne}
						/>
					)}
				</div>
			</div>
			{selection.size > 0 ? (
				<MultiSelectBar
					count={selection.size}
					totalSize={selectionTotal}
					onCancel={cancelSelect}
					onAddToCleanup={addSelectedToCleanup}
				/>
			) : (
				<div className="flex h-[28px] items-center border-t border-line-soft px-3 font-mono text-[11px] text-muted">
					{readableSize(tree.size)}
					{tree.capacity !== tree.size && (
						<>
							<span className="mx-[6px]">·</span>
							{readableSize(tree.capacity)} capacity
						</>
					)}
				</div>
			)}
			{issuesOpen && (
				<IssuesModal errors={scanErrors} onClose={() => setIssuesOpen(false)} />
			)}
			{perfOpen && perfTree && (
				<PerfModal tree={perfTree} onClose={() => setPerfOpen(false)} />
			)}
		</>
	);
};
