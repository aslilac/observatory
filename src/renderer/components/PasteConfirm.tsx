import { AlertDialog } from "@base-ui/react/alert-dialog";

import { Button } from "./Button";

type PasteConfirmProps = {
	open: boolean;
	path: string | null;
	stat: Ob.PathStat | null;
	onCancel: () => void;
	onConfirm: () => void;
};

export const PasteConfirm: React.FC<PasteConfirmProps> = ({
	open,
	path,
	stat,
	onCancel,
	onConfirm,
}) => {
	const validating = stat === null;
	const blocked = stat !== null && (!stat.exists || !stat.isDirectory);

	return (
		<AlertDialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="fixed inset-0 z-30 bg-[rgba(0,0,0,0.32)]" />
				<AlertDialog.Popup className="fixed top-1/2 left-1/2 z-30 w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-modal bg-background p-6 outline-none [box-shadow:var(--shadow-modal)]">
					<AlertDialog.Title className="mb-[12px] text-[16px] font-semibold">
						Scan this folder?
					</AlertDialog.Title>
					<AlertDialog.Description
						className="mb-[16px] truncate rounded-card border border-line-soft bg-fill px-[12px] py-[10px] font-mono text-[12px]"
						title={path ?? undefined}
					>
						{path}
					</AlertDialog.Description>
					{blocked && (
						<div className="mb-[16px] text-[12px] text-danger-fg">
							{stat?.exists
								? "That path isn't a directory."
								: "Couldn't find that path on disk."}
						</div>
					)}
					<div className="flex justify-end gap-2">
						<Button onClick={onCancel}>Cancel</Button>
						<Button
							variant="primary"
							onClick={onConfirm}
							disabled={validating || blocked}
						>
							{validating ? "Checking…" : "Scan"}
						</Button>
					</div>
				</AlertDialog.Popup>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
};
