import React from "react";

type SearchBarProps = {
	query: string;
	onQueryChange: (next: string) => void;
	matchCount: number | null;
	loading: boolean;
};

export const SearchBar = ({
	query,
	onQueryChange,
	matchCount,
	loading,
}: SearchBarProps) => (
	<div className="flex items-center gap-[8px] border-b border-line-soft px-[14px] py-[8px]">
		<div className="flex flex-1 items-center gap-[8px] rounded-[7px] border border-line bg-fill px-[10px] py-[5px]">
			<SearchIcon />
			<input
				type="text"
				value={query}
				onChange={(e) => onQueryChange(e.target.value)}
				placeholder="Find files in this scan…"
				className="flex-1 border-none bg-transparent font-sans text-[12px] text-ink outline-none placeholder:text-faint"
			/>
			{query && (
				<button
					type="button"
					onClick={() => onQueryChange("")}
					title="Clear search"
					className="cursor-pointer text-[12px] leading-none text-faint hover:text-ink"
				>
					×
				</button>
			)}
			{query && matchCount !== null && (
				<span className="font-mono text-[11px] text-muted">
					{loading ? "…" : `${matchCount.toLocaleString()} matches`}
				</span>
			)}
		</div>
	</div>
);

const SearchIcon = () => (
	<svg
		width="12"
		height="12"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		className="text-muted"
	>
		<circle cx="11" cy="11" r="7" />
		<path d="M21 21l-4.35-4.35" />
	</svg>
);
