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
			<svg width="44" height="44" viewBox="0 0 44 44">
				<circle
					cx="22"
					cy="22"
					r="20"
					fill="none"
					stroke="var(--color-line)"
					strokeWidth="1.5"
					strokeDasharray="3 4"
				/>
				<g className="origin-center animate-spin [animation-duration:2.4s]">
					<path
						d="M 22 2 A 20 20 0 0 1 42 22"
						fill="none"
						stroke="var(--color-default)"
						strokeWidth="3"
						strokeLinecap="round"
					/>
				</g>
			</svg>
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
		<svg width="260" height="260" viewBox="0 0 260 260">
			<circle
				cx="130"
				cy="130"
				r="118"
				fill="none"
				stroke="var(--color-line)"
				strokeWidth="2"
				strokeDasharray="3 4"
			/>
			<g className="origin-center animate-spin [animation-duration:2.4s]">
				<path
					d="M 130 12 A 118 118 0 0 1 248 130"
					fill="none"
					stroke="var(--color-default)"
					strokeWidth="6"
					strokeLinecap="round"
				/>
			</g>
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
		</svg>
	</div>
);

function compactNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return n.toLocaleString();
}
