import { AlertCircleIcon } from "lucide-react";

type IssuesChipProps = {
	errors: Ob.ScanError[];
	onClick: () => void;
};

export const IssuesChip: React.FC<IssuesChipProps> = ({ errors, onClick }) => {
	// Folders macOS's privacy protection kept us out of are one issue, with
	// one fix (Full Disk Access), however many of them there are. So are the
	// ones Windows keeps for administrators (restart as one).
	let count = errors.length;
	for (const kind of ["protected", "admin"]) {
		const folded = errors.filter((e) => e.kind === kind).length;
		count -= folded > 0 ? folded - 1 : 0;
	}
	if (count === 0) {
		return null;
	}
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
