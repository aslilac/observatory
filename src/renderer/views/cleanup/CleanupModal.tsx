import React, { useState } from "react";

import type { CleanupItem } from "#/state";
import { readableSize } from "#/util";
import { Button } from "#/components/Button";

type CleanupModalProps = {
	items: CleanupItem[];
	totalSize: number;
	onClose: () => void;
	onTrash: (
		items: CleanupItem[],
	) => Promise<{ deleted: number; reclaimed: number; failed: number }>;
};

type Stage =
	| { kind: "confirm" }
	| { kind: "deleting" }
	| {
			kind: "success";
			deleted: number;
			reclaimed: number;
			failed: number;
	  };

export const CleanupModal: React.FC<CleanupModalProps> = ({
	items,
	totalSize,
	onClose,
	onTrash,
}) => {
	const [stage, setStage] = useState<Stage>({ kind: "confirm" });
	// Snapshot the queue at modal-open time. Anything queued from a different
	// window (or another concurrent action) after the user clicks
	// "Review & delete" stays out of this confirmation — they only act on
	// what they actually reviewed.
	const [snapshot] = useState(() => ({ items, totalSize }));

	const handleTrash = async () => {
		setStage({ kind: "deleting" });
		try {
			const result = await onTrash(snapshot.items);
			setStage({ kind: "success", ...result });
		} catch {
			onClose();
		}
	};

	return (
		<div
			className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(0,0,0,0.32)]"
			onClick={(e) => {
				// Click backdrop to dismiss only when in the safe stages.
				if (e.target === e.currentTarget && stage.kind !== "deleting") {
					onClose();
				}
			}}
		>
			<div
				className="w-[480px] rounded-modal bg-background p-[24px] [box-shadow:var(--shadow-modal)]"
				role="dialog"
				aria-modal="true"
			>
				{stage.kind === "confirm" && (
					<ConfirmStage
						items={snapshot.items}
						totalSize={snapshot.totalSize}
						onCancel={onClose}
						onTrash={() => void handleTrash()}
					/>
				)}
				{stage.kind === "deleting" && <DeletingStage />}
				{stage.kind === "success" && (
					<SuccessStage
						deleted={stage.deleted}
						reclaimed={stage.reclaimed}
						failed={stage.failed}
						onClose={onClose}
					/>
				)}
			</div>
		</div>
	);
};

type ConfirmStageProps = {
	items: CleanupItem[];
	totalSize: number;
	onCancel: () => void;
	onTrash: () => void;
};

const ConfirmStage: React.FC<ConfirmStageProps> = ({
	items,
	totalSize,
	onCancel,
	onTrash,
}) => {
	const preview = items.slice(0, 5);
	const overflow = items.length - preview.length;
	return (
		<>
			<div className="mb-[12px] flex items-center gap-[8px]">
				<AlertIcon />
				<div className="text-[16px] font-semibold">
					Move {items.length} item{items.length === 1 ? "" : "s"} to Trash?
				</div>
			</div>
			<div className="mb-[14px] text-[13px] text-muted">
				This will move{" "}
				<span className="font-mono font-semibold text-default">
					{readableSize(totalSize)}
				</span>{" "}
				across {items.length} path{items.length === 1 ? "" : "s"} to your system
				Trash. You can restore items from Trash until you empty it.
			</div>
			<div className="mb-[20px] rounded-card border border-line-soft bg-fill px-[12px] py-[10px] font-mono text-[11px] text-default">
				{preview.map((item) => (
					<div key={item.path} className="truncate" title={item.path}>
						{item.path}
					</div>
				))}
				{overflow > 0 && <div className="text-muted">+ {overflow} more</div>}
			</div>
			<div className="flex justify-end gap-[8px]">
				<Button onClick={onCancel}>Cancel</Button>
				<Button variant="danger" onClick={onTrash}>
					Move to Trash
				</Button>
			</div>
		</>
	);
};

const DeletingStage: React.FC = () => (
	<div className="flex items-center justify-center py-[32px] font-mono text-[12px] text-muted">
		Moving items to Trash…
	</div>
);

type SuccessStageProps = {
	deleted: number;
	reclaimed: number;
	failed: number;
	onClose: () => void;
};

const SuccessStage: React.FC<SuccessStageProps> = ({
	deleted,
	reclaimed,
	failed,
	onClose,
}) => (
	<>
		<div className="mb-[8px] text-[16px] font-semibold">Cleanup complete</div>
		<div className="mb-[24px] text-[13px] text-muted">
			<span className="font-mono text-default">{deleted}</span> item
			{deleted === 1 ? "" : "s"} moved ·{" "}
			<span className="font-mono text-default">{readableSize(reclaimed)}</span>{" "}
			reclaimed.
			{failed > 0 && (
				<div className="mt-[8px] text-danger-fg">
					{failed} item{failed === 1 ? "" : "s"} could not be moved.
				</div>
			)}
		</div>
		<div className="flex justify-end">
			<Button variant="primary" onClick={onClose}>
				Done
			</Button>
		</div>
	</>
);

const AlertIcon: React.FC = () => (
	<svg
		width="18"
		height="18"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		className="text-default"
	>
		<circle cx="12" cy="12" r="10" />
		<path d="M12 8v4" />
		<path d="M12 16h.01" />
	</svg>
);
