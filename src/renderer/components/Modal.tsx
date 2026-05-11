import { Dialog } from "@base-ui/react/dialog";

type ModalProps = {
	open: boolean;
	onClose: () => void;
	className?: string;
	children: React.ReactNode;
};

// Thin wrapper around Base UI Dialog that owns the controlled-state plumbing
// and the centered-overlay shell. Layout inside the popup is the caller's
// problem; pass extra classes via `className`.
export const Modal: React.FC<ModalProps> = ({
	open,
	onClose,
	className,
	children,
}) => (
	<Dialog.Root
		open={open}
		onOpenChange={(next) => {
			if (!next) {
				onClose();
			}
		}}
	>
		<Dialog.Portal>
			<Dialog.Backdrop className="fixed inset-0 z-20 bg-[rgba(0,0,0,0.32)]" />
			<Dialog.Popup
				className={`fixed top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-modal bg-background p-[24px] [box-shadow:var(--shadow-modal)] outline-none ${className ?? ""}`}
			>
				{children}
			</Dialog.Popup>
		</Dialog.Portal>
	</Dialog.Root>
);

export { Dialog };
