import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useCallback, useState } from "react";
import { Button } from "./Button";

// macOS: the first time the user scans something, if the app doesn't have Full
// Disk Access, it asks for it before the scan starts, rather than leaving them
// to find the folders it missed afterwards. The app can't grant itself access,
// but it can open the right page of System Settings. Asked once: after that,
// what a scan couldn't get into is in its issues, with the same button.

const ASKED_KEY = "observatory:fullDiskAccessAsked";

function wasAsked(): boolean {
	try {
		return localStorage.getItem(ASKED_KEY) === "1";
	} catch {
		return false;
	}
}

function markAsked() {
	try {
		localStorage.setItem(ASKED_KEY, "1");
	} catch {
		// localStorage unavailable: it asks again next time
	}
}

// Wraps `open` (scan a path and go to it) so the first scan asks first.
export function useFullDiskAccessPrompt(open: (path: string) => void) {
	const [pending, setPending] = useState<string | null>(null);

	const request = useCallback(
		async (path: string) => {
			if (
				Ob.platform !== "darwin" ||
				path.startsWith("fake://") ||
				wasAsked() ||
				(await Ob.hasFullDiskAccess())
			) {
				open(path);
				return;
			}
			setPending(path);
		},
		[open],
	);

	const grant = useCallback(() => {
		markAsked();
		setPending(null);
		// Granting it takes a restart, which macOS offers, so the scan waits.
		void Ob.openFullDiskAccessSettings();
	}, []);

	const skip = useCallback(() => {
		markAsked();
		setPending(null);
		if (pending) {
			open(pending);
		}
	}, [open, pending]);

	// Escape, or a click outside: neither scans nor answers, so it asks again.
	const cancel = useCallback(() => setPending(null), []);

	return { request, pending, grant, skip, cancel };
}

type FullDiskAccessPromptProps = {
	open: boolean;
	onGrant: () => void;
	onSkip: () => void;
	onCancel: () => void;
};

export const FullDiskAccessPrompt: React.FC<FullDiskAccessPromptProps> = ({
	open,
	onGrant,
	onSkip,
	onCancel,
}) => (
	<AlertDialog.Root
		open={open}
		onOpenChange={(next) => {
			if (!next) {
				onCancel();
			}
		}}
	>
		<AlertDialog.Portal>
			<AlertDialog.Backdrop className="fixed inset-0 z-30 bg-[rgba(0,0,0,0.32)]" />
			<AlertDialog.Popup className="fixed top-1/2 left-1/2 z-30 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-modal bg-background p-6 [box-shadow:var(--shadow-modal)] outline-none">
				<AlertDialog.Title className="mb-[12px] text-[16px] font-semibold">
					Give Observatory Full Disk Access?
				</AlertDialog.Title>
				<AlertDialog.Description
					render={<div />}
					className="mb-[20px] flex flex-col gap-[8px] text-[13px] text-muted"
				>
					<p>
						macOS keeps apps out of Mail, Messages, Safari, and other apps' data
						unless you give them Full Disk Access. Without it, those folders are
						left out of the scan, and what it finds comes up short.
					</p>
					<p>
						Turn Observatory on in the list, then reopen it when macOS asks.
					</p>
				</AlertDialog.Description>
				<div className="flex justify-end gap-2">
					<Button onClick={onSkip}>Scan without it</Button>
					<Button variant="primary" onClick={onGrant}>
						Open System Settings
					</Button>
				</div>
			</AlertDialog.Popup>
		</AlertDialog.Portal>
	</AlertDialog.Root>
);
