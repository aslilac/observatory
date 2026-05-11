import { useCallback } from "react";

import { useNavigation } from "#/navigation";
import { useScanProgress } from "#/state";
import { Button } from "#/components/Button";
import { FlameGraph } from "#/components/FlameGraph";
import { Toolbar } from "#/components/Toolbar";
import { CleanupChip } from "../cleanup/CleanupChip";

type ScanningProps = {
	scan: Ob.ScanInfo;
	root: string;
};

export const Scanning: React.FC<ScanningProps> = ({ scan, root }) => {
	const { setInspecting } = useNavigation();
	const progress = useScanProgress(scan.path, scan.status === "building");

	const onCancel = useCallback(() => {
		void Ob.cancelScan(scan.path);
		setInspecting(null);
	}, [scan.path, setInspecting]);

	const counts = progress?.counts;
	const total =
		(counts?.files ?? 0) +
		(counts?.directories ?? 0) +
		(counts?.symlinks ?? 0) +
		(counts?.devices ?? 0) +
		(counts?.misc ?? 0);

	const perfTree = progress?.perfTree ?? null;

	return (
		<>
			<Toolbar
				root={root}
				scanning
				right={
					<Button size="small" onClick={onCancel}>
						Cancel scan
					</Button>
				}
				chips={<CleanupChip />}
			/>
			{perfTree ? (
				<div className="flex min-h-0 flex-1 flex-col gap-4 px-7 py-5">
					<ScanHeader root={root} total={total} progress={progress} />
					<div className="flex min-h-0 flex-1 flex-col">
						<FlameGraph tree={perfTree} />
					</div>
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center px-7">
					<div className="flex flex-col items-center gap-[18px]">
						<Spinner total={total} />
						<div className="flex flex-col items-center gap-1 text-center">
							<div className="text-[16px] font-semibold">{root}</div>
							<CurrentPath progress={progress} />
						</div>
					</div>
				</div>
			)}
		</>
	);
};

type ScanHeaderProps = {
	root: string;
	total: number;
	progress: Ob.ScanProgress | null;
};

const ScanHeader: React.FC<ScanHeaderProps> = ({ root, total, progress }) => (
	<div className="flex items-center gap-4">
		<div className="relative size-[44px] shrink-0">
			<SpinnerArc size={44} radius={20} trackWidth={1.5} arcWidth={3} />
		</div>
		<div className="flex min-w-0 flex-1 flex-col gap-[2px]">
			<div className="flex items-baseline gap-[10px]">
				<div className="text-[14px] font-semibold">{root}</div>
				<div className="font-mono text-[11px] text-muted">
					{total > 0 ? `${compactNumber(total)} items` : "indexing"}
				</div>
			</div>
			<CurrentPath progress={progress} />
		</div>
	</div>
);

type CurrentPathProps = { progress: Ob.ScanProgress | null };

const CurrentPath: React.FC<CurrentPathProps> = ({ progress }) => (
	<div className="max-w-full truncate font-mono text-[11px] text-muted">
		indexing&nbsp;
		<span className="text-default">{progress?.currentPath}</span>
	</div>
);

type SpinnerProps = {
	total: number;
};

const Spinner: React.FC<SpinnerProps> = ({ total }) => (
	<div className="relative size-[260px]">
		<SpinnerArc size={260} radius={118} trackWidth={2} arcWidth={6}>
			<circle cx="130" cy="130" r="62" fill="var(--color-default)" />
			<text
				x="130"
				y="128"
				textAnchor="middle"
				dominantBaseline="middle"
				fill="var(--color-background)"
				fontFamily="IBM Plex Mono, ui-monospace, monospace"
				fontSize="20"
				fontWeight="600"
			>
				{total > 0 ? compactNumber(total) : "scanning"}
			</text>
			<text
				x="130"
				y="148"
				textAnchor="middle"
				dominantBaseline="middle"
				fill="var(--color-background)"
				fillOpacity="0.55"
				fontFamily="IBM Plex Mono, ui-monospace, monospace"
				fontSize="11"
			>
				{total > 0 ? "items" : "indexing"}
			</text>
		</SpinnerArc>
	</div>
);

type SpinnerArcProps = {
	size: number;
	radius: number;
	trackWidth: number;
	arcWidth: number;
	children?: React.ReactNode;
};

const SpinnerArc: React.FC<SpinnerArcProps> = ({
	size,
	radius,
	trackWidth,
	arcWidth,
	children,
}) => {
	const c = size / 2;
	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
			<circle
				cx={c}
				cy={c}
				r={radius}
				fill="none"
				stroke="var(--color-line)"
				strokeWidth={trackWidth}
				strokeDasharray="3 4"
			/>
			<g className="origin-center animate-spin [animation-duration:2.4s]">
				<path
					d={`M ${c} ${c - radius} A ${radius} ${radius} 0 0 1 ${c + radius} ${c}`}
					fill="none"
					stroke="var(--color-default)"
					strokeWidth={arcWidth}
					strokeLinecap="round"
				/>
			</g>
			{children}
		</svg>
	);
};

function compactNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return n.toLocaleString();
}
