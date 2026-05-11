export type SortMode = "size" | "name" | "newest" | "oldest";

const OPTIONS: ReadonlyArray<{ value: SortMode; label: string }> = [
	{ value: "size", label: "Size (largest)" },
	{ value: "name", label: "Name (A → Z)" },
	{ value: "newest", label: "Most recent" },
	{ value: "oldest", label: "Least recent" },
];

const LABEL: Record<SortMode, string> = {
	size: "size",
	name: "name",
	newest: "newest",
	oldest: "oldest",
};

type SortPickerProps = {
	value: SortMode;
	onChange: (next: SortMode) => void;
};

export const SortPicker: React.FC<SortPickerProps> = ({ value, onChange }) => (
	<label className="relative inline-flex h-8 cursor-pointer items-center gap-1 rounded-button border border-line bg-background px-2.5 font-mono text-[11px] text-default hover:bg-fill">
		<span className="text-muted">Sort:</span>
		<span>{LABEL[value]}</span>
		<span className="pl-1 text-[12px] text-faint">▾</span>
		<select
			value={value}
			onChange={(e) => onChange(e.target.value as SortMode)}
			className="absolute inset-0 cursor-pointer opacity-0"
			aria-label="Sort items"
		>
			{OPTIONS.map((o) => (
				<option key={o.value} value={o.value}>
					{o.label}
				</option>
			))}
		</select>
	</label>
);
