import { Autocomplete } from "@base-ui/react/autocomplete";
import { SearchIcon, TextSearchIcon, XIcon } from "lucide-react";

import { readableSize } from "#/format";
import { FINDERS, finderInfo } from "./finders";

// A row in the suggestions: names that contain what's typed, or a finder.
type Suggestion = { finder: Ob.Finder | null; label: string };

type FindBarProps = {
	text: string;
	onTextChange: (next: string) => void;
	// Shown as a chip ahead of the text, which takes its place once typed.
	finder: Ob.Finder | null;
	onPickFinder: (finder: Ob.Finder) => void;
	onClearFinder: () => void;
	// Back to no query at all.
	onClear: () => void;
	suggesting: boolean;
	onSuggestingChange: (open: boolean) => void;
	// How much each finder finds, null while they're being counted.
	summaries: Ob.FinderSummary[] | null;
	// What the text finds, for its row.
	named: Ob.Found | null;
	scopeName: string;
	right?: React.ReactNode;
};

// The field over the sunburst. Focused, it suggests the finders, with how
// much each finds, and as text is typed, finding it in names; the list
// beside the sunburst shows what's found.
export const FindBar: React.FC<FindBarProps> = ({
	text,
	onTextChange,
	finder,
	onPickFinder,
	onClearFinder,
	onClear,
	suggesting,
	onSuggestingChange,
	summaries,
	named,
	scopeName,
	right,
}) => {
	const typed = text.trim();
	const needle = typed.toLowerCase();
	const suggestions: Suggestion[] = [
		...(typed ? [{ finder: null, label: `Names with “${typed}”` }] : []),
		...FINDERS.filter(
			(info) => !needle || info.label.toLowerCase().includes(needle),
		).map((info) => ({ finder: info.finder, label: info.label })),
	];
	const byFinder = new Map(summaries?.map((s) => [s.finder, s]));

	return (
		<div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
			<Autocomplete.Root
				items={suggestions}
				filteredItems={suggestions}
				itemToStringValue={(s: Suggestion) => s.label}
				value={text}
				onValueChange={(next, details) => {
					// Picking a suggestion runs it, rather than typing its label.
					if (details.reason !== "item-press") {
						onTextChange(next);
					}
				}}
				open={suggesting}
				onOpenChange={onSuggestingChange}
				openOnInputClick
				autoHighlight
			>
				<Autocomplete.InputGroup className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-fill px-2.5">
					<SearchIcon size={12} strokeWidth={2} className="text-muted" />
					{finder && (
						<span className="flex-shrink-0 rounded-[4px] bg-fill-strong px-[6px] py-[1px] text-[11px] font-medium">
							{finderInfo(finder).label}
						</span>
					)}
					<Autocomplete.Input
						onFocus={() => onSuggestingChange(true)}
						onKeyDown={(e) => {
							// The first Escape closes the suggestions, the next
							// clears the query.
							if (e.key === "Escape" && !suggesting) {
								onClear();
								e.currentTarget.blur();
							} else if (e.key === "Backspace" && !text && finder) {
								onClearFinder();
							}
						}}
						placeholder={finder ? "" : `Find in ${scopeName}…`}
						className="min-w-0 flex-1 border-none bg-transparent font-sans text-[12px] text-default outline-none placeholder:text-faint"
					/>
					{(text || finder) && (
						<button
							type="button"
							onClick={onClear}
							title="Clear"
							className="grid size-[18px] cursor-pointer place-items-center rounded-full text-faint hover:bg-fill-strong hover:text-default"
						>
							<XIcon size={12} strokeWidth={2} />
						</button>
					)}
				</Autocomplete.InputGroup>
				<Autocomplete.Portal>
					<Autocomplete.Positioner
						className="z-50 outline-none"
						sideOffset={4}
						align="start"
					>
						<Autocomplete.Popup className="w-[400px] max-w-[var(--available-width)] rounded-card border border-line-soft bg-background p-1 text-[13px] [box-shadow:var(--shadow-menu)] outline-none">
							{!typed && (
								<div className="truncate px-[8px] pt-[6px] pb-[4px] text-[11px] text-faint">
									Often worth cleaning up in {scopeName}
								</div>
							)}
							<Autocomplete.List className="outline-none">
								{(suggestion: Suggestion) => {
									const info = suggestion.finder
										? finderInfo(suggestion.finder)
										: null;
									const Icon = info?.icon ?? TextSearchIcon;
									const summary = suggestion.finder
										? byFinder.get(suggestion.finder)
										: named && {
												count: named.totalCount,
												size: named.totalSize,
											};
									const none = summary?.count === 0;
									return (
										<Autocomplete.Item
											key={suggestion.finder ?? "name"}
											value={suggestion}
											disabled={none && info !== null}
											onClick={() =>
												suggestion.finder
													? onPickFinder(suggestion.finder)
													: onSuggestingChange(false)
											}
											className="flex cursor-default items-center gap-[10px] rounded-[5px] px-[8px] py-[6px] outline-none select-none data-[disabled]:opacity-60 data-[highlighted]:bg-fill"
										>
											<span className="grid size-[26px] flex-shrink-0 place-items-center rounded-[6px] bg-fill text-muted">
												<Icon size={14} strokeWidth={1.7} />
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate">
													{suggestion.label}
												</span>
												<span className="block truncate text-[11px] text-faint">
													{info?.description ?? `In ${scopeName}`}
												</span>
											</span>
											<span className="flex-shrink-0 text-right tabular-nums">
												{!summary ? (
													<span className="text-[12px] text-faint">…</span>
												) : none ? (
													<span className="text-[12px] text-faint">None</span>
												) : (
													<>
														<span className="block text-[12px] text-muted">
															{readableSize(summary.size)}
														</span>
														<span className="block text-[11px] text-faint">
															{summary.count.toLocaleString()}{" "}
															{summary.count === 1 ? "item" : "items"}
														</span>
													</>
												)}
											</span>
										</Autocomplete.Item>
									);
								}}
							</Autocomplete.List>
						</Autocomplete.Popup>
					</Autocomplete.Positioner>
				</Autocomplete.Portal>
			</Autocomplete.Root>
			{right}
		</div>
	);
};
