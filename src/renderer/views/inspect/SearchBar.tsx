import { SearchIcon } from "lucide-react";

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
<<<<<<< HEAD
		<div className="flex flex-1 items-center gap-2 rounded-md border border-line bg-fill px-2.5 h-8">
			<SearchIcon size={12} strokeWidth={2} className="text-muted" />
=======
		<div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-line bg-fill px-2.5">
			<SearchIcon />
>>>>>>> d08ea6b (enable tailwind sorting)
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
