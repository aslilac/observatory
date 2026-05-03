import React from "react";

import { readableSize } from "../../util";
import { Button } from "../Button";

type MultiSelectBarProps = {
	count: number;
	totalSize: number;
	onAddToCleanup: () => void;
	onCancel: () => void;
};

export const MultiSelectBar = ({
	count,
	totalSize,
	onAddToCleanup,
	onCancel,
}: MultiSelectBarProps) => (
	<div className="flex items-center gap-3 border-t border-line-soft bg-paper px-3 py-[8px]">
		<div className="flex-1 text-[12px]">
			<span className="font-medium">{count}</span>{" "}
			<span className="text-muted">selected ·</span>{" "}
			<span className="font-mono">{readableSize(totalSize)}</span>
		</div>
		<Button size="small" onClick={onCancel}>
			Cancel
		</Button>
		<Button size="small" variant="primary" onClick={onAddToCleanup}>
			Add to cleanup
		</Button>
	</div>
);
