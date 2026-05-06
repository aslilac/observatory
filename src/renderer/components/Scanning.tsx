import { Button } from "./Button";
import { FlameGraph } from "./FlameGraph";
import { Toolbar } from "./Toolbar";

type ScanningProps = {
	root: string;
	progress: Ob.ScanProgress | null;
	onCancel: () => void;
	chips: React.ReactNode;
};

export const Scanning: React.FC<ScanningProps> = ({
	root,
	progress,
	onCancel,
	chips,
}) => {
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
				chips={chips}
			/>
			{perfTree ? (
				<div className="flex min-h-0 flex-1 flex-col gap-[16px] px-[28px] py-[20px]">
					<ScanHeader root={root} total={total} progress={progress} />
					<div className="flex min-h-0 flex-1 flex-col">
						<FlameGraph tree={perfTree} />
					</div>
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center px-[28px]">
					<div className="flex flex-col items-center gap-[18px]">
						<Spinner total={total} />
						<div className="flex flex-col items-center gap-[4px] text-center">
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
	<div className="flex items-center gap-[16px]">
		<div className="relative h-[44px] w-[44px] shrink-0">
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

const CurrentPath: React.FC<{ progress: Ob.ScanProgress | null }> = ({
	progress,
}) => (
	<div
		className="max-w-[100%] truncate font-mono text-[11px] text-muted"
		title={progress?.currentPath ?? undefined}
	>
		{progress?.currentPath ? (
			<>
				indexing&nbsp;
				<span className="text-default">{progress.currentPath}</span>
			</>
		) : (
			"hold tight — counting files"
		)}
	</div>
);

const Spinner: React.FC<{ total: number }> = ({ total }) => (
	<div className="relative h-[260px] w-[260px]">
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
