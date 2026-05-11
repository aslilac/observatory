import { AlertCircleIcon } from "lucide-react";

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
			<AlertCircleIcon size={11} />
			<span className="font-medium">
				{count.toLocaleString()} {count === 1 ? "issue" : "issues"}
			</span>
		</button>
	);
};
