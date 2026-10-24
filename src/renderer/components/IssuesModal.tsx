import { ShieldIcon } from "lucide-react";
import React, { useMemo, useState } from "react";

import { Button } from "./Button";
import { Dialog, Modal } from "./Modal";

type IssuesModalProps = {
	open: boolean;
	errors: Ob.ScanError[];
	onClose: () => void;
};

// "protected" isn't listed: those get the Full Disk Access card instead.
const KIND_LABEL: Record<ListedKind, string> = {
	permission: "Permission denied",
	missing: "Missing entries",
	loop: "Symlink loops",
	other: "Other errors",
};

type ListedKind = Exclude<Ob.ScanError["kind"], "protected">;

const KIND_ORDER: ListedKind[] = ["permission", "missing", "loop", "other"];

export const IssuesModal: React.FC<IssuesModalProps> = ({
	open,
	errors,
	onClose,
}) => {
	const grouped = useMemo(() => {
		const buckets = new Map<Ob.ScanError["kind"], Ob.ScanError[]>();
		for (const e of errors) {
			const list = buckets.get(e.kind) ?? [];
			list.push(e);
			buckets.set(e.kind, list);
		}
		return buckets;
	}, [errors]);

	return (
		<Modal open={open} onClose={onClose} className="w-[560px]">
			<div className="mb-[16px] flex items-baseline justify-between">
				<div>
					<Dialog.Title className="text-[16px] font-semibold">
						Scan issues
					</Dialog.Title>
					<Dialog.Description className="font-mono text-[11px] text-muted">
						{errors.length} entr{errors.length === 1 ? "y" : "ies"} skipped or
						unreadable
					</Dialog.Description>
				</div>
				<Dialog.Close className="cursor-pointer text-[18px] leading-none text-faint outline-none hover:text-default">
					×
				</Dialog.Close>
			</div>

			{grouped.has("protected") && (
				<FullDiskAccess errors={grouped.get("protected")!} />
			)}

			{KIND_ORDER.some((k) => grouped.has(k)) && (
				<div className="max-h-[400px] overflow-auto rounded-card border border-line-soft">
					{KIND_ORDER.filter((k) => grouped.has(k)).map((kind, idx, arr) => {
						const list = grouped.get(kind)!;
						return (
							<div
								key={kind}
								className={
									idx < arr.length - 1 ? "border-b border-line-soft" : ""
								}
							>
								<div className="flex items-baseline justify-between bg-fill px-[12px] py-[6px]">
									<div className="text-[12px] font-semibold">
										{KIND_LABEL[kind]}
									</div>
									<div className="font-mono text-[11px] text-muted">
										{list.length}
									</div>
								</div>
								<ErrorRows errors={list} />
							</div>
						);
					})}
				</div>
			)}

			<div className="mt-[20px] flex justify-end">
				<Button
					// The card's button is the one to press, when there is one.
					variant={grouped.has("protected") ? "default" : "primary"}
					onClick={onClose}
				>
					Close
				</Button>
			</div>
		</Modal>
	);
};

// Everything macOS's privacy protection kept the scan out of, as one issue
// with its fix: the app can't grant itself access, but it can open the
// right page of System Settings.
const FullDiskAccess: React.FC<{ errors: Ob.ScanError[] }> = ({ errors }) => {
	const [showFolders, setShowFolders] = useState(false);
	const count = errors.length.toLocaleString();

	return (
		<div className="mb-[12px] rounded-card border border-line-soft bg-fill p-[14px]">
			<div className="flex items-center gap-[8px] text-[13px] font-semibold">
				<ShieldIcon size={14} strokeWidth={1.8} />
				{errors.length === 1
					? "1 folder is protected by macOS"
					: `${count} folders are protected by macOS`}
			</div>
			<p className="mt-[6px] text-[12px] text-muted">
				macOS keeps apps out of Mail, Messages, Safari, and other apps' data
				unless you give them Full Disk Access. To include{" "}
				{errors.length === 1 ? "it" : "them"}, turn Observatory on in the list,
				reopen it when macOS asks, and scan again.
			</p>
			<div className="mt-[12px] flex items-center gap-[8px]">
				<Button
					variant="primary"
					size="small"
					onClick={() => void Ob.openFullDiskAccessSettings()}
				>
					Open System Settings
				</Button>
				<Button size="small" onClick={() => setShowFolders((show) => !show)}>
					{showFolders ? "Hide folders" : "Show folders"}
				</Button>
			</div>
			{showFolders && (
				<div className="mt-[12px] max-h-[200px] overflow-auto rounded-card border border-line-soft bg-background">
					<ErrorRows errors={errors} />
				</div>
			)}
		</div>
	);
};

const ErrorRows: React.FC<{ errors: Ob.ScanError[] }> = ({ errors }) => (
	<div>
		{errors.slice(0, 50).map((err, i) => (
			<div key={`${err.path}-${i}`} className="px-[12px] py-[5px] text-[11px]">
				<div className="truncate font-mono text-default" title={err.path}>
					{err.path}
				</div>
				<div className="truncate font-mono text-[10px] text-muted">
					{err.code ? `${err.code} · ` : ""}
					{err.message}
				</div>
			</div>
		))}
		{errors.length > 50 && (
			<div className="px-[12px] py-[6px] font-mono text-[10px] text-muted">
				… {errors.length - 50} more not shown
			</div>
		)}
	</div>
);
