import { rowActions } from "#/contextActions";
import { readableSize } from "#/util";
import { Checkbox } from "#/components/Checkbox";
import { RowMenu } from "#/components/ContextMenu";
import type { SelectableItem } from "./types";

type SearchResultsProps = {
	results: Ob.SearchResults | null;
	loading: boolean;
	query: string;
	selection: Map<string, SelectableItem>;
	onToggleSelect: (item: SelectableItem) => void;
	onAddToCleanup: (item: SelectableItem) => void;
};

export const SearchResults: React.FC<SearchResultsProps> = ({
	results,
	loading,
	query,
	selection,
	onToggleSelect,
	onAddToCleanup,
}) => {
	if (!query.trim()) {
		return null;
	}

	if (loading && !results) {
		return (
			<div className="flex items-center justify-center py-[40px] font-mono text-[12px] text-muted">
				searching…
			</div>
		);
	}

	if (!results || results.matches.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-[6px] py-[40px] text-[13px]">
				<div className="font-medium">No matches</div>
				<div className="font-mono text-[11px] text-muted">
					Nothing in this scan contains{" "}
					<span className="text-default">{query}</span>.
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col text-[13px]">
			<div className="mb-[4px] flex items-baseline justify-between border-b border-line py-[8px] pr-[4px] pl-[4px]">
				<div className="text-[14px] font-semibold">
					{results.totalCount.toLocaleString()} match
					{results.totalCount === 1 ? "" : "es"}
				</div>
				<div className="font-mono text-[12px] text-default">
					{readableSize(results.totalSize)}
				</div>
			</div>
			{results.matches.map((match) => {
				const item: SelectableItem = {
					path: match.path,
					name: basename(match.path),
					size: match.size,
				};
				const isSelected = selection.has(match.path);
				return (
					<RowMenu
						key={match.path}
						onClick={() => onToggleSelect(item)}
						items={rowActions({
							path: match.path,
							name: item.name,
							size: match.size,
							type: match.type,
							onAddToCleanup,
						})}
						className={`group flex cursor-pointer items-center gap-[8px] rounded-[5px] px-[8px] py-[7px] ${
							isSelected ? "bg-fill" : "hover:bg-fill"
						}`}
					>
						<Checkbox
							checked={isSelected}
							onChange={() => onToggleSelect(item)}
						/>
						<span
							className="min-w-0 flex-1 truncate font-mono text-[12px]"
							title={match.path}
						>
							{match.path}
						</span>
						<span className="ml-[8px] flex-shrink-0 font-mono text-[11px] text-muted">
							{readableSize(match.size)}
						</span>
					</RowMenu>
				);
			})}
			{results.truncated && (
				<div className="mt-[6px] py-[8px] text-center font-mono text-[11px] text-muted">
					Showing top {results.matches.length} of{" "}
					{results.totalCount.toLocaleString()} — refine the query to see more.
				</div>
			)}
		</div>
	);
};

function basename(p: string): string {
	const trimmed = p.replace(/[/\\]+$/, "");
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return slash >= 0 ? trimmed.slice(slash + 1) || trimmed : trimmed;
}
