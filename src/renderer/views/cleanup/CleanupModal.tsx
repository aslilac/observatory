import { useState } from "react";

import { type CleanupItem, useCleanupQueue } from "#/state";
import { readableSize } from "#/format";
import { Button } from "#/components/Button";
import { Dialog, Modal } from "#/components/Modal";

type CleanupModalProps = {
	items: CleanupItem[];
	totalSize: number;
	onClose: () => void;
};

type Stage =
	| { kind: "confirm" }
	| { kind: "deleting"; mode: Ob.DeleteMode }
	| {
			kind: "done";
			mode: Ob.DeleteMode;
			deleted: number;
			reclaimed: number;
			failed: Ob.DeleteResult["failed"];
	  };

// Asks before anything's deleted, then does it. Deleting for good is what
// frees the space, so it's the main action; the Trash is one click away for
// whoever wants a way back.
export const CleanupModal: React.FC<CleanupModalProps> = ({
	items,
	totalSize,
	onClose,
}) => {
	const { remove } = useCleanupQueue();
	const [stage, setStage] = useState<Stage>({ kind: "confirm" });
	// What's queued when the dialog opens. Anything moved to cleanup after
	// (from another window, say) stays out of it: only what was asked about
	// goes.
	const [asked] = useState(() => ({ items, totalSize }));

	const run = async (mode: Ob.DeleteMode) => {
		setStage({ kind: "deleting", mode });
		const sizes = new Map(asked.items.map((i) => [i.path, i.size]));
		try {
			const result = await Ob.deleteFiles(
				asked.items.map((i) => i.path),
				mode,
			);
			for (const path of result.deleted) {
				remove(path);
			}
			setStage({
				kind: "done",
				mode,
				deleted: result.deleted.length,
				reclaimed: result.deleted.reduce(
					(sum, p) => sum + (sizes.get(p) ?? 0),
					0,
				),
				failed: result.failed,
			});
		} catch {
			onClose();
		}
	};

	return (
		<Modal
			open
			// Not while it's deleting: there's no stopping it.
			onClose={stage.kind === "deleting" ? () => {} : onClose}
			className="w-[460px]"
		>
			{stage.kind === "confirm" && (
				<Confirm
					items={asked.items}
					totalSize={asked.totalSize}
					onCancel={onClose}
					onRun={(mode) => void run(mode)}
				/>
			)}
			{stage.kind === "deleting" && (
				<div className="py-[28px] text-center text-[13px] text-muted">
					{stage.mode === "trash" ? "Moving to the Trash…" : "Deleting…"}
				</div>
			)}
			{stage.kind === "done" && <Done {...stage} onClose={onClose} />}
		</Modal>
	);
};

type ConfirmProps = {
	items: CleanupItem[];
	totalSize: number;
	onCancel: () => void;
	onRun: (mode: Ob.DeleteMode) => void;
};

const Confirm: React.FC<ConfirmProps> = ({
	items,
	totalSize,
	onCancel,
	onRun,
}) => {
	const shown = items.slice(0, 5);
	const more = items.length - shown.length;
	return (
		<>
			<Dialog.Title className="mb-[6px] text-[16px] font-semibold">
				Delete {plural(items.length, "item")}?
			</Dialog.Title>
			<Dialog.Description className="mb-[16px] text-[13px] text-muted">
				That's{" "}
				<span className="font-semibold text-default tabular-nums">
					{readableSize(totalSize)}
				</span>{" "}
				gone for good, which can't be undone. Move it to the Trash instead to
				keep a way back until you empty it.
			</Dialog.Description>
			<div className="mb-[20px] rounded-card border border-line-soft px-[12px] py-[8px] text-[12px]">
				{shown.map((item) => (
					<div
						key={item.path}
						className="flex justify-between gap-[12px] py-[2px]"
						title={item.path}
					>
						<span className="truncate">{item.name}</span>
						<span className="flex-shrink-0 text-muted tabular-nums">
							{readableSize(item.size)}
						</span>
					</div>
				))}
				{more > 0 && (
					<div className="py-[2px] text-muted tabular-nums">
						and {more.toLocaleString()} more
					</div>
				)}
			</div>
			<div className="flex gap-[8px]">
				<Button onClick={onCancel}>Cancel</Button>
				<div className="flex-1" />
				<Button onClick={() => onRun("trash")}>Move to Trash</Button>
				<Button variant="danger" onClick={() => onRun("delete")}>
					Delete
				</Button>
			</div>
		</>
	);
};

type DoneProps = {
	mode: Ob.DeleteMode;
	deleted: number;
	reclaimed: number;
	failed: Ob.DeleteResult["failed"];
	onClose: () => void;
};

const Done: React.FC<DoneProps> = ({
	mode,
	deleted,
	reclaimed,
	failed,
	onClose,
}) => (
	<>
		<Dialog.Title className="mb-[6px] text-[16px] font-semibold">
			{deleted === 0
				? "Nothing was deleted"
				: mode === "trash"
					? `Moved ${plural(deleted, "item")} to the Trash`
					: `Deleted ${plural(deleted, "item")}`}
		</Dialog.Title>
		{deleted > 0 && (
			<Dialog.Description className="text-[13px] text-muted">
				{mode === "trash" ? "Empty the Trash to free " : "That freed "}
				<span className="font-semibold text-default tabular-nums">
					{readableSize(reclaimed)}
				</span>
				.
			</Dialog.Description>
		)}
		{failed.length > 0 && (
			<div className="mt-[14px]">
				<div className="mb-[6px] text-[13px] text-danger-fg">
					{plural(failed.length, "item")} couldn't be{" "}
					{mode === "trash" ? "moved" : "deleted"}, and{" "}
					{failed.length === 1 ? "is" : "are"} still in cleanup:
				</div>
				<div className="max-h-[160px] overflow-auto rounded-card border border-line-soft px-[12px] py-[8px] text-[12px]">
					{failed.map((f) => (
						<div key={f.path} className="py-[2px]">
							<div className="truncate" title={f.path}>
								{f.path}
							</div>
							<div className="truncate text-[11px] text-muted">{f.error}</div>
						</div>
					))}
				</div>
			</div>
		)}
		<div className="mt-[20px] flex justify-end">
			<Button variant="primary" onClick={onClose}>
				Done
			</Button>
		</div>
	</>
);

function plural(count: number, noun: string): string {
	return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}
