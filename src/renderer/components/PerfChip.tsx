import { FlameIcon } from "lucide-react";

type PerfChipProps = {
	available: boolean;
	onClick: () => void;
};

export const PerfChip: React.FC<PerfChipProps> = ({ available, onClick }) => {
	if (!available) {
		return null;
	}
	return (
		<button
			type="button"
			onClick={onClick}
			className="ml-[6px] inline-flex cursor-pointer items-center gap-[6px] rounded-full border border-line bg-fill px-[10px] py-[4px] font-sans text-[11px] text-default hover:opacity-90"
			title="Open scan timing flame graph"
		>
			<FlameIcon size={11} />
			<span className="font-medium">perf</span>
		</button>
	);
};
