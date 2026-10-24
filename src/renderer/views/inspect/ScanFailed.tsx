import { useNavigation } from "#/navigation";
import { Button } from "#/components/Button";
import { Toolbar } from "#/components/Toolbar";
import { CleanupChip } from "../cleanup/CleanupChip";

type ScanFailedProps = {
	scan: Ob.ScanInfo;
	root: string;
	onRetry: (path: string) => void;
};

// Shown in place of Inspect when the scan root itself couldn't be walked —
// most often a recent folder that has since been moved or deleted, or one
// that lives on a drive that isn't plugged in.
export const ScanFailed: React.FC<ScanFailedProps> = ({
	scan,
	root,
	onRetry,
}) => {
	const { showMenu } = useNavigation();
	const kind = scan.error?.kind ?? "other";

	return (
		<>
			<Toolbar root={root} chips={<CleanupChip />} />
			<div className="flex flex-1 flex-col items-center justify-center gap-4 px-7 text-center">
				<div className="text-[20px] font-semibold">{title(kind, root)}</div>
				<div className="max-w-[440px] text-[13px] text-muted">
					{explanation(kind)}
				</div>
				<div
					className="max-w-[560px] truncate rounded-card border border-line-soft bg-fill px-[12px] py-[8px] font-mono text-[12px] select-text"
					title={scan.path}
				>
					{scan.path}
				</div>
				{kind === "other" && scan.error && (
					<div className="max-w-[480px] font-mono text-[11px] text-muted select-text">
						{scan.error.message}
					</div>
				)}
				<div className="flex gap-2">
					{kind === "permission" && Ob.platform === "darwin" && (
						<Button onClick={() => void Ob.openFullDiskAccessSettings()}>
							Open System Settings
						</Button>
					)}
					<Button onClick={() => onRetry(scan.path)}>Try again</Button>
					<Button variant="primary" onClick={showMenu}>
						Back to disks and folders
					</Button>
				</div>
			</div>
		</>
	);
};

function title(kind: Ob.ScanError["kind"], root: string): string {
	switch (kind) {
		case "missing":
			return `“${root}” couldn't be found`;
		case "permission":
			return `Observatory can't read “${root}”`;
		default:
			return `Couldn't scan “${root}”`;
	}
}

function explanation(kind: Ob.ScanError["kind"]): string {
	switch (kind) {
		case "missing":
			return "It may have been moved, renamed, or deleted, or it's on a drive that isn't connected right now.";
		case "permission":
			return Ob.platform === "darwin"
				? "Grant Observatory access in System Settings → Privacy & Security → Files and Folders (or Full Disk Access), then try again."
				: "Your account doesn't have permission to read this folder.";
		default:
			return "Something went wrong reading this folder.";
	}
}
