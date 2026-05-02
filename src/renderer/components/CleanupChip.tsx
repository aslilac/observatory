import React from "react";

import { readableSize } from "../util";

type CleanupChipProps = {
	count: number;
	totalSize: number;
	onClick: () => void;
};

export const CleanupChip = ({ count, totalSize, onClick }: CleanupChipProps) => {
	if (count === 0) {
		return (
			<button
				type="button"
				onClick={onClick}
				className="ml-[6px] inline-flex cursor-pointer items-center gap-[6px] rounded-full border border-dashed border-line bg-transparent px-[10px] py-[5px] font-sans text-[11px] text-muted hover:border-ink hover:text-ink"
				title="Open cleanup queue"
			>
				<TrashIcon />
				<span>Cleanup</span>
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={onClick}
			className="ml-[6px] inline-flex cursor-pointer items-center gap-[8px] rounded-full border border-ink bg-paper py-[4px] pr-[4px] pl-[10px] font-sans text-[11px] text-ink hover:bg-fill"
			title="Open cleanup queue"
		>
			<TrashIcon />
			<span className="font-medium">Cleanup</span>
			<span className="font-mono text-muted">·</span>
			<span className="font-mono">{count}</span>
			<span className="rounded-full bg-ink px-[9px] py-[3px] font-mono text-[10px] font-semibold text-paper">
				{readableSize(totalSize)}
			</span>
		</button>
	);
};

const TrashIcon = () => (
	<svg
		width="12"
		height="12"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M3 6h18" />
		<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
		<path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
	</svg>
);
