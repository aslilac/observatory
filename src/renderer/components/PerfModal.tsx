import { Button } from "./Button";
import { Dialog, Modal } from "./Modal";
import { FlameGraph } from "./FlameGraph";

type PerfModalProps = {
	open: boolean;
	tree: Ob.PerfNode | null;
	onClose: () => void;
};

export const PerfModal: React.FC<PerfModalProps> = ({
	open,
	tree,
	onClose,
}) => (
	<Modal
		open={open}
		onClose={onClose}
		className="flex max-h-[88vh] w-[min(1100px,92vw)] flex-col gap-[16px]"
	>
		<div className="flex items-baseline justify-between">
			<div>
				<Dialog.Title className="text-[16px] font-semibold">
					Scan timing
				</Dialog.Title>
				<Dialog.Description className="font-mono text-[11px] text-muted">
					per-directory wall time, click a node to zoom
				</Dialog.Description>
			</div>
			<Dialog.Close className="cursor-pointer text-[18px] leading-none text-faint outline-none hover:text-default">
				×
			</Dialog.Close>
		</div>
		<div className="flex min-h-0 flex-1 flex-col">
			{tree && <FlameGraph tree={tree} />}
		</div>
		<div className="flex justify-end">
			<Button variant="primary" onClick={onClose}>
				Close
			</Button>
		</div>
	</Modal>
);
