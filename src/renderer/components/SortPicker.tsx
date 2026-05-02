import React from "react";

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

export const SortPicker = ({ value, onChange }: SortPickerProps) => (
	<label className="relative inline-flex cursor-pointer items-center gap-[6px] rounded-button border border-line bg-paper py-[4px] pr-[22px] pl-[10px] font-mono text-[11px] text-ink hover:bg-fill">
		<span className="text-muted">Sort:</span>
		<span>{LABEL[value]}</span>
		<span className="pointer-events-none absolute right-[8px] top-1/2 -translate-y-1/2 text-[9px] text-faint">
			▾
		</span>
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
