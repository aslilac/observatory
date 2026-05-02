import React, { useState } from "react";

import type { CleanupItem } from "../state";
import { readableSize } from "../util";
import { Button } from "./Button";

type CleanupModalProps = {
	items: CleanupItem[];
	totalSize: number;
	onClose: () => void;
	onRemove: (path: string) => void;
	onTrash: () => Promise<{ deleted: number; reclaimed: number; failed: number }>;
};

type Stage =
	| { kind: "list" }
	| { kind: "confirm" }
	| { kind: "deleting" }
	| {
			kind: "success";
			deleted: number;
			reclaimed: number;
			failed: number;
	  };

export const CleanupModal = ({
	items,
	totalSize,
	onClose,
	onRemove,
	onTrash,
}: CleanupModalProps) => {
	const [stage, setStage] = useState<Stage>({ kind: "list" });

	const handleTrash = async () => {
		setStage({ kind: "deleting" });
		try {
			const result = await onTrash();
			setStage({ kind: "success", ...result });
		} catch {
			setStage({ kind: "list" });
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
				className="w-[480px] rounded-modal bg-paper p-[24px] [box-shadow:var(--shadow-modal)]"
				role="dialog"
				aria-modal="true"
			>
				{stage.kind === "list" && (
					<ListStage
						items={items}
						totalSize={totalSize}
						onClose={onClose}
						onRemove={onRemove}
						onConfirm={() => setStage({ kind: "confirm" })}
					/>
				)}
				{stage.kind === "confirm" && (
					<ConfirmStage
						count={items.length}
						totalSize={totalSize}
						onCancel={() => setStage({ kind: "list" })}
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

const ListStage = ({
	items,
	totalSize,
	onClose,
	onRemove,
	onConfirm,
}: {
	items: CleanupItem[];
	totalSize: number;
	onClose: () => void;
	onRemove: (path: string) => void;
	onConfirm: () => void;
}) => (
	<>
		<div className="mb-[16px] flex items-baseline justify-between">
			<div>
				<div className="text-[16px] font-semibold">Cleanup queue</div>
				<div className="font-mono text-[11px] text-muted">
					{items.length} item{items.length === 1 ? "" : "s"} ·{" "}
					{readableSize(totalSize)}
				</div>
			</div>
			<button
				type="button"
				onClick={onClose}
				className="cursor-pointer text-[18px] leading-none text-faint hover:text-ink"
			>
				×
			</button>
		</div>

		<div className="max-h-[320px] overflow-auto rounded-card border border-line-soft">
			{items.map((item, i) => (
				<div
					key={item.path}
					className={`flex items-center gap-[10px] px-[12px] py-[8px] text-[12px] ${
						i < items.length - 1 ? "border-b border-line-soft" : ""
					}`}
				>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[12px]">{item.name}</div>
						<div className="truncate font-mono text-[10px] text-muted">
							{item.path}
						</div>
					</div>
					<div className="font-mono text-[11px] text-muted">
						{readableSize(item.size)}
					</div>
					<button
						type="button"
						onClick={() => onRemove(item.path)}
						className="cursor-pointer text-[14px] leading-none text-faint hover:text-ink"
						title="Remove from queue"
					>
						×
					</button>
				</div>
			))}
		</div>

		<div className="mt-[20px] flex justify-end gap-[8px]">
			<Button onClick={onClose}>Close</Button>
			<Button variant="primary" onClick={onConfirm}>
				Move to Trash
			</Button>
		</div>
	</>
);

const ConfirmStage = ({
	count,
	totalSize,
	onCancel,
	onTrash,
}: {
	count: number;
	totalSize: number;
	onCancel: () => void;
	onTrash: () => void;
}) => (
	<>
		<div className="mb-[12px] text-[16px] font-semibold">
			Move {count} item{count === 1 ? "" : "s"} to Trash?
		</div>
		<div className="mb-[24px] text-[13px] text-muted">
			<span className="font-mono text-ink">{readableSize(totalSize)}</span>{" "}
			will be reclaimed. Items go to your system Trash and can be restored
			from there.
		</div>
		<div className="flex justify-end gap-[8px]">
			<Button onClick={onCancel}>Cancel</Button>
			<Button variant="danger" onClick={onTrash}>
				Move to Trash
			</Button>
		</div>
	</>
);

const DeletingStage = () => (
	<div className="flex items-center justify-center py-[32px] font-mono text-[12px] text-muted">
		Moving items to Trash…
	</div>
);

const SuccessStage = ({
	deleted,
	reclaimed,
	failed,
	onClose,
}: {
	deleted: number;
	reclaimed: number;
	failed: number;
	onClose: () => void;
}) => (
	<>
		<div className="mb-[8px] text-[16px] font-semibold">Cleanup complete</div>
		<div className="mb-[24px] text-[13px] text-muted">
			<span className="font-mono text-ink">{deleted}</span> item
			{deleted === 1 ? "" : "s"} moved ·{" "}
			<span className="font-mono text-ink">{readableSize(reclaimed)}</span>{" "}
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
