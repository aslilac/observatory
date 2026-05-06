type PerfChipProps = {
	available: boolean;
	onClick: () => void;
};

export const PerfChip: React.FC<PerfChipProps> = ({ available, onClick }) => {
	if (!available) return null;
	return (
		<button
			type="button"
			onClick={onClick}
			className="ml-[6px] inline-flex cursor-pointer items-center gap-[6px] rounded-full border border-line bg-fill px-[10px] py-[4px] font-sans text-[11px] text-default hover:opacity-90"
			title="Open scan timing flame graph"
		>
			<FlameIcon />
			<span className="font-medium">perf</span>
		</button>
	);
};

const FlameIcon: React.FC = () => (
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
		<path d="M8.5 14.5A2.5 2.5 0 0 0 11 17a2.5 2.5 0 0 0 2.5-2.5c0-1.5-.5-2-1-3a4.5 4.5 0 0 1-.5-2 6 6 0 0 1-3 5 4 4 0 0 0-1 2.5z" />
		<path d="M12 2c1 3 2 4.5 4 6.5s4 4.5 4 8a8 8 0 0 1-16 0c0-2 1-4 2.5-5.5C8 9.5 9 8 9 5c1 .5 2 1.5 2 3l1-6z" />
	</svg>
);
