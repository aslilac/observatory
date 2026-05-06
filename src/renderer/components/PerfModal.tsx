import { Button } from "./Button";
import { FlameGraph } from "./FlameGraph";

type PerfModalProps = {
	tree: Ob.PerfNode;
	onClose: () => void;
};

export const PerfModal: React.FC<PerfModalProps> = ({ tree, onClose }) => {
	return (
		<div
			className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(0,0,0,0.32)]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				className="flex max-h-[88vh] w-[min(1100px,92vw)] flex-col gap-[16px] rounded-modal bg-background p-[24px] [box-shadow:var(--shadow-modal)]"
				role="dialog"
				aria-modal="true"
			>
				<div className="flex items-baseline justify-between">
					<div>
						<div className="text-[16px] font-semibold">Scan timing</div>
						<div className="font-mono text-[11px] text-muted">
							per-directory wall time, click a node to zoom
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="cursor-pointer text-[18px] leading-none text-faint hover:text-default"
					>
						×
					</button>
				</div>
				<div className="flex min-h-0 flex-1 flex-col">
					<FlameGraph tree={tree} />
				</div>
				<div className="flex justify-end">
					<Button variant="primary" onClick={onClose}>
						Close
					</Button>
				</div>
			</div>
		</div>
	);
};
