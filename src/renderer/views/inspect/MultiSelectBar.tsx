import { readableSize } from "#/format";
import { Button } from "#/components/Button";

type MultiSelectBarProps = {
	count: number;
	totalSize: number;
	onMoveToCleanup: () => void;
	onCancel: () => void;
};

export const MultiSelectBar: React.FC<MultiSelectBarProps> = ({
	count,
	totalSize,
	onMoveToCleanup,
	onCancel,
}) => (
	<div className="flex items-center gap-3 border-t border-line-soft bg-background px-3 py-2">
		<div className="flex-1 text-[12px]">
			<span className="font-medium">{count}</span>{" "}
			<span className="text-muted">selected ·</span>{" "}
			<span className="tabular-nums">{readableSize(totalSize)}</span>
		</div>
		<Button size="small" onClick={onCancel}>
			Cancel
		</Button>
		<Button size="small" variant="primary" onClick={onMoveToCleanup}>
			Move to cleanup
		</Button>
	</div>
);
