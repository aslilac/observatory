import React from "react";

export const DropOverlay = () => (
	<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[rgba(26,26,26,0.32)] p-[24px]">
		<div className="flex min-h-[60%] w-full flex-col items-center justify-center gap-[14px] rounded-modal border-[2.5px] border-dashed border-paper bg-[rgba(250,250,248,0.08)] p-[40px] text-paper">
			<FolderIcon />
			<div className="text-[20px] font-semibold">Drop folder to scan</div>
			<div className="font-mono text-[12px] opacity-80">
				Anything you drop here will start a fresh scan.
			</div>
		</div>
	</div>
);

const FolderIcon = () => (
	<svg
		width="56"
		height="56"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.4"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
	</svg>
);
