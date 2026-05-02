import React from "react";

import { Toolbar } from "./Toolbar";

type ScanningProps = {
	root: string;
	onShowMenu: () => void;
};

export const Scanning = ({ root, onShowMenu }: ScanningProps) => (
	<>
		<Toolbar root={root} onShowMenu={onShowMenu} scanning />
		<div className="flex flex-1 items-center justify-center px-[28px]">
			<div className="flex flex-col items-center gap-[18px]">
				<div className="relative h-[260px] w-[260px]">
					<svg width="260" height="260" viewBox="0 0 260 260">
						{/* Faint outer ring */}
						<circle
							cx="130"
							cy="130"
							r="118"
							fill="none"
							stroke="#d8d6cf"
							strokeWidth="2"
							strokeDasharray="3 4"
						/>
						{/* Indeterminate sweep arc — animated via CSS */}
						<g className="origin-center animate-spin [animation-duration:2.4s]">
							<path
								d="M 130 12 A 118 118 0 0 1 248 130"
								fill="none"
								stroke="#1a1a1a"
								strokeWidth="6"
								strokeLinecap="round"
							/>
						</g>
						{/* Center disc */}
						<circle cx="130" cy="130" r="62" fill="#1a1a1a" />
						<text
							x="130"
							y="128"
							textAnchor="middle"
							dominantBaseline="middle"
							fill="#fafaf8"
							fontFamily="IBM Plex Mono, ui-monospace, monospace"
							fontSize="20"
							fontWeight="600"
						>
							scanning
						</text>
						<text
							x="130"
							y="148"
							textAnchor="middle"
							dominantBaseline="middle"
							fill="rgba(255,255,255,0.55)"
							fontFamily="IBM Plex Mono, ui-monospace, monospace"
							fontSize="11"
						>
							indexing
						</text>
					</svg>
				</div>
				<div className="text-center">
					<div className="text-[16px] font-semibold">{root}</div>
					<div className="mt-1 font-mono text-[12px] text-muted">
						hold tight — counting files
					</div>
				</div>
			</div>
		</div>
	</>
);
