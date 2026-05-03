import type { CleanupItem } from "../../state";
import { readableSize } from "../../util";
import { Button } from "../Button";
import { Toolbar } from "../Toolbar";

type CleanupProps = {
	items: CleanupItem[];
	totalSize: number;
	onRemove: (path: string) => void;
	onClear: () => void;
	onReview: () => void;
	canBack: boolean;
	canForward: boolean;
	onBack: () => void;
	onForward: () => void;
	onShowMenu: () => void;
	onBrowseFiles: () => void;
	chips: React.ReactNode;
};

export const Cleanup = ({
	items,
	totalSize,
	onRemove,
	onClear,
	onReview,
	canBack,
	canForward,
	onBack,
	onForward,
	onShowMenu,
	onBrowseFiles,
	chips,
}: CleanupProps) => {
	const empty = items.length === 0;
	return (
		<>
			<Toolbar
				view="Cleanup"
				onShowMenu={onShowMenu}
				canBack={canBack}
				canForward={canForward}
				onBack={onBack}
				onForward={onForward}
				right={
					!empty && (
						<div className="flex gap-[6px]">
							<Button size="small" onClick={onClear}>
								Clear queue
							</Button>
							<Button size="small" variant="primary" onClick={onReview}>
								Review &amp; delete
							</Button>
						</div>
					)
				}
				chips={chips}
			/>
			{empty ? (
				<EmptyState onBrowseFiles={onBrowseFiles} />
			) : (
				<QueueList items={items} totalSize={totalSize} onRemove={onRemove} />
			)}
		</>
	);
};

const EmptyState = ({ onBrowseFiles }: { onBrowseFiles: () => void }) => (
	<div className="flex flex-1 flex-col items-center justify-center gap-[14px] px-[28px]">
		<div className="grid h-[68px] w-[68px] place-items-center rounded-full border border-dashed border-line text-muted">
			<TrashIcon />
		</div>
		<div className="text-center text-[16px] font-semibold">
			Nothing queued for cleanup
		</div>
		<div className="max-w-[420px] text-center text-[12px] text-muted">
			Open a scan and use the checkboxes to stage files or folders here. Nothing
			is deleted until you confirm.
		</div>
		<Button onClick={onBrowseFiles}>Browse files</Button>
	</div>
);

const QueueList = ({
	items,
	totalSize,
	onRemove,
}: {
	items: CleanupItem[];
	totalSize: number;
	onRemove: (path: string) => void;
}) => (
	<div className="flex flex-1 flex-col overflow-hidden px-[28px] py-[20px]">
		<div className="mb-[18px] flex items-end justify-between">
			<div>
				<div className="eyebrow">You'll reclaim</div>
				<div className="font-mono text-[40px] leading-[1.1] font-semibold text-ink">
					{readableSize(totalSize)}
				</div>
			</div>
			<div className="text-right font-mono text-[12px] text-muted">
				{items.length} item{items.length === 1 ? "" : "s"}
			</div>
		</div>
		<div className="min-h-0 flex-1 overflow-auto rounded-card border border-line-soft">
			{items.map((item, i) => (
				<div
					key={item.path}
					className={`flex items-center gap-[10px] px-3 py-[8px] text-[12px] ${
						i < items.length - 1 ? "border-b border-line-soft" : ""
					}`}
				>
					<span className="w-[64px] flex-shrink-0 font-mono text-[11px] text-muted">
						{kindLabel(item)}
					</span>
					<span
						className="min-w-0 flex-1 truncate font-mono text-ink"
						title={item.path}
					>
						{item.path}
					</span>
					<span className="flex-shrink-0 font-mono text-[11px] text-muted">
						{readableSize(item.size)}
					</span>
					<button
						type="button"
						onClick={() => onRemove(item.path)}
						title="Remove from queue"
						className="cursor-pointer text-[14px] leading-none text-faint hover:text-ink"
					>
						×
					</button>
				</div>
			))}
		</div>
	</div>
);

function kindLabel(item: CleanupItem): string {
	const name = item.name.toLowerCase();
	if (!name.includes(".")) return "folder";
	const ext = name.slice(name.lastIndexOf(".") + 1);
	if (
		ext === "mov" ||
		ext === "mp4" ||
		ext === "mkv" ||
		ext === "avi" ||
		ext === "webm"
	) {
		return "video";
	}
	if (
		ext === "zip" ||
		ext === "tar" ||
		ext === "gz" ||
		ext === "bz2" ||
		ext === "xz" ||
		ext === "7z"
	) {
		return "archive";
	}
	if (ext === "dmg" || ext === "iso") return "disk image";
	if (ext === "fcpbundle" || ext === "logicx" || ext === "app") return "bundle";
	if (
		ext === "jpg" ||
		ext === "jpeg" ||
		ext === "png" ||
		ext === "gif" ||
		ext === "heic"
	) {
		return "image";
	}
	if (ext === "mp3" || ext === "wav" || ext === "flac" || ext === "aac") {
		return "audio";
	}
	if (ext === "pdf") return "pdf";
	return "file";
}

const TrashIcon = () => (
	<svg
		width="22"
		height="22"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.6"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M3 6h18" />
		<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
		<path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
	</svg>
);
