type IssuesChipProps = {
	count: number;
	onClick: () => void;
};

export const IssuesChip: React.FC<IssuesChipProps> = ({ count, onClick }) => {
	if (count === 0) return null;
	return (
		<button
			type="button"
			onClick={onClick}
			className="ml-[6px] inline-flex cursor-pointer items-center gap-[6px] rounded-full border border-danger-border bg-danger-bg px-[10px] py-[4px] font-sans text-[11px] text-danger-fg hover:opacity-90"
			title={`${count} scan ${count === 1 ? "issue" : "issues"} — click to view`}
		>
			<AlertIcon />
			<span className="font-medium">
				{count.toLocaleString()} {count === 1 ? "issue" : "issues"}
			</span>
		</button>
	);
};

const AlertIcon: React.FC = () => (
	<svg
		width="11"
		height="11"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<circle cx="12" cy="12" r="10" />
		<path d="M12 8v4" />
		<path d="M12 16h.01" />
	</svg>
);
