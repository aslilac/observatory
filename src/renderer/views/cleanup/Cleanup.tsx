import { useCallback, useState } from "react";

import { type CleanupItem, useCleanupQueue } from "#/state";
import { readableSize } from "#/util";
import { Button } from "#/components/Button";
import { Toolbar } from "#/components/Toolbar";
import { CleanupChip } from "./CleanupChip";
import { CleanupModal } from "./CleanupModal";

export const Cleanup: React.FC = () => {
	const { items, totalSize, remove, clear } = useCleanupQueue();
	const [confirmOpen, setConfirmOpen] = useState(false);

	const onTrash = useCallback(
		async (queued: CleanupItem[]) => {
			const sizeByPath = new Map(queued.map((i) => [i.path, i.size]));
			const result = await Ob.deleteFiles(queued.map((i) => i.path));
			const reclaimed = result.deleted.reduce(
				(sum, p) => sum + (sizeByPath.get(p) ?? 0),
				0,
			);
			for (const p of result.deleted) remove(p);
			return {
				deleted: result.deleted.length,
				reclaimed,
				failed: result.failed.length,
			};
		},
		[remove],
	);

	const empty = items.length === 0;
	return (
		<>
			<Toolbar
				view="Cleanup"
				right={
					!empty && (
						<div className="flex gap-[6px]">
							<Button size="small" onClick={clear}>
								Clear queue
							</Button>
							<Button
								size="small"
								variant="primary"
								onClick={() => setConfirmOpen(true)}
							>
								Review &amp; delete
							</Button>
						</div>
					)
				}
				chips={<CleanupChip />}
			/>
			{empty ? (
				<EmptyState onBrowseFiles={() => void Ob.selectDirectory()} />
			) : (
				<QueueList items={items} totalSize={totalSize} onRemove={remove} />
			)}
			{confirmOpen && (
				<CleanupModal
					items={items}
					totalSize={totalSize}
					onClose={() => setConfirmOpen(false)}
					onTrash={onTrash}
				/>
			)}
		</>
	);
};

type EmptyStateProps = {
	onBrowseFiles: () => void;
};

const EmptyState: React.FC<EmptyStateProps> = ({ onBrowseFiles }) => (
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

type QueueListProps = {
	items: CleanupItem[];
	totalSize: number;
	onRemove: (path: string) => void;
};

const QueueList: React.FC<QueueListProps> = ({
	items,
	totalSize,
	onRemove,
}) => (
	<div className="flex flex-1 flex-col overflow-hidden px-[28px] py-[20px]">
		<div className="mb-[18px] flex items-end justify-between">
			<div>
				<div className="eyebrow">You'll reclaim</div>
				<div className="font-mono text-[40px] leading-[1.1] font-semibold text-default">
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
						className="min-w-0 flex-1 truncate font-mono text-default"
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
						className="cursor-pointer text-[14px] leading-none text-faint hover:text-default"
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

const TrashIcon: React.FC = () => (
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
