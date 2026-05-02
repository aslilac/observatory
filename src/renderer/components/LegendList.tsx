import React from "react";

import { hueFor, oklchSwatch } from "../colors";
import { readableSize } from "../util";

type LegendListProps = {
	name: string;
	size: number;
	capacity: number;
	files: Ob.VfsNode[];
	onForward: (name: string) => void;
};

export const LegendList = ({
	name,
	size,
	capacity,
	files,
	onForward,
}: LegendListProps) => {
	const free = capacity > size ? capacity - size : 0;

	return (
		<div className="flex flex-col text-[13px]">
			<div className="mb-1 flex justify-between border-b border-line py-[8px] pr-[4px] pl-[4px]">
				<div>
					<div className="text-[14px] font-semibold">{name}</div>
				</div>
				<div className="font-mono text-[13px] text-ink">
					{readableSize(size)}
				</div>
			</div>

			{files.map((file, i) => {
				const interactive = file.type === "directory";
				return (
					<button
						key={`${file.name}-${i}`}
						type="button"
						onClick={interactive ? () => onForward(file.name) : undefined}
						disabled={!interactive}
						className="flex items-center justify-between rounded-[5px] px-[8px] py-[7px] text-left disabled:cursor-default enabled:hover:bg-fill"
					>
						<span className="flex min-w-0 items-center gap-[8px]">
							<span
								className="block h-[8px] w-[8px] flex-shrink-0 rounded-full"
								style={{ background: oklchSwatch(hueFor(i)) }}
							/>
							<span className="truncate">{file.name}</span>
						</span>
						<span className="ml-[12px] flex-shrink-0 font-mono text-[12px] text-muted">
							{readableSize(file.size)}
						</span>
					</button>
				);
			})}

			{free > 0 && (
				<div className="mt-[8px] flex justify-between border-t border-line-soft px-[8px] pt-[10px] pb-[4px] text-[12px] text-muted">
					<span className="flex items-center gap-[8px]">
						<span className="block h-[8px] w-[8px] rounded-full border border-faint" />
						free space
					</span>
					<span className="font-mono">{readableSize(free)}</span>
				</div>
			)}
		</div>
	);
};
