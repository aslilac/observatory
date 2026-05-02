import React from "react";

import { Button } from "./Button";

type PasteConfirmProps = {
	path: string;
	stat: Ob.PathStat | null;
	onCancel: () => void;
	onConfirm: () => void;
};

export const PasteConfirm = ({
	path,
	stat,
	onCancel,
	onConfirm,
}: PasteConfirmProps) => {
	const validating = stat === null;
	const blocked = stat !== null && (!stat.exists || !stat.isDirectory);

	return (
		<div
			className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(0,0,0,0.32)]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onCancel();
			}}
		>
			<div
				className="w-[480px] rounded-modal bg-paper p-[24px] [box-shadow:var(--shadow-modal)]"
				role="dialog"
				aria-modal="true"
			>
				<div className="mb-[12px] text-[16px] font-semibold">
					Scan this folder?
				</div>
				<div
					className="mb-[16px] truncate rounded-card border border-line-soft bg-fill px-[12px] py-[10px] font-mono text-[12px]"
					title={path}
				>
					{path}
				</div>
				{blocked && (
					<div className="mb-[16px] text-[12px] text-danger-fg">
						{stat?.exists
							? "That path isn't a directory."
							: "Couldn't find that path on disk."}
					</div>
				)}
				<div className="flex justify-end gap-[8px]">
					<Button onClick={onCancel}>Cancel</Button>
					<Button
						variant="primary"
						onClick={onConfirm}
						disabled={validating || blocked}
					>
						{validating ? "Checking…" : "Scan"}
					</Button>
				</div>
			</div>
		</div>
	);
};
