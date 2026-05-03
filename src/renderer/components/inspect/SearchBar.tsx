type SearchBarProps = {
	query: string;
	onQueryChange: (next: string) => void;
	matchCount: number | null;
	loading: boolean;
	right?: React.ReactNode;
};

export const SearchBar: React.FC<SearchBarProps> = ({
	query,
	onQueryChange,
	matchCount,
	loading,
	right,
}) => (
	<div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
		<div className="flex flex-1 items-center gap-2 rounded-md border border-line bg-fill px-2.5 h-8">
			<SearchIcon />
			<input
				type="text"
				value={query}
				onChange={(e) => onQueryChange(e.target.value)}
				placeholder="Find files in this scan…"
				className="flex-1 border-none bg-transparent font-sans text-[12px] text-default outline-none placeholder:text-faint"
			/>
			{query && (
				<button
					type="button"
					onClick={() => onQueryChange("")}
					title="Clear search"
					className="cursor-pointer text-[12px] leading-none text-faint hover:text-default"
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
		{right}
	</div>
);

const SearchIcon: React.FC = () => (
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
