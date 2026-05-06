import { Button } from "./Button";
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

	const slowest = progress?.slowest;

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
			<div className="flex min-h-0 flex-1 items-center justify-center gap-[36px] px-[28px]">
				<div className="flex flex-col items-center gap-[18px]">
					<div className="relative h-[260px] w-[260px]">
						<svg width="260" height="260" viewBox="0 0 260 260">
							{/* Faint outer ring */}
							<circle
								cx="130"
								cy="130"
								r="118"
								fill="none"
								stroke="var(--color-line)"
								strokeWidth="2"
								strokeDasharray="3 4"
							/>
							{/* Indeterminate sweep arc — animated via CSS */}
							<g className="origin-center animate-spin [animation-duration:2.4s]">
								<path
									d="M 130 12 A 118 118 0 0 1 248 130"
									fill="none"
									stroke="var(--color-default)"
									strokeWidth="6"
									strokeLinecap="round"
								/>
							</g>
							{/* Center disc */}
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
					<div className="flex flex-col items-center gap-[4px] text-center">
						<div className="text-[16px] font-semibold">{root}</div>
						<div
							className="max-w-[460px] truncate font-mono text-[12px] text-muted"
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
					</div>
				</div>
				{slowest && slowest.length > 0 && (
					<SlowDirsPanel entries={slowest} root={progress!.path} />
				)}
			</div>
		</>
	);
};

type SlowDirsPanelProps = {
	entries: Ob.DirectoryPerf[];
	root: string;
};

const SlowDirsPanel: React.FC<SlowDirsPanelProps> = ({ entries, root }) => {
	const visible = entries.slice(0, 20);
	const max = visible[0]?.selfMs ?? 1;
	return (
		<div className="flex max-h-[460px] w-[440px] flex-col gap-[10px] rounded border border-line bg-fill px-[14px] py-[12px]">
			<div className="flex items-baseline justify-between">
				<div className="text-[12px] font-semibold uppercase tracking-wider text-muted">
					slowest directories
				</div>
				<div className="font-mono text-[10px] text-muted">self-time</div>
			</div>
			<div className="flex min-h-0 flex-col gap-[4px] overflow-y-auto">
				{visible.map((entry) => (
					<SlowDirRow key={entry.path} entry={entry} max={max} root={root} />
				))}
			</div>
		</div>
	);
};

type SlowDirRowProps = {
	entry: Ob.DirectoryPerf;
	max: number;
	root: string;
};

const SlowDirRow: React.FC<SlowDirRowProps> = ({ entry, max, root }) => {
	const widthPct = Math.max(2, (entry.selfMs / max) * 100);
	const display =
		entry.path === root
			? entry.path
			: entry.path.startsWith(`${root}/`)
				? entry.path.slice(root.length + 1)
				: entry.path;
	return (
		<div
			className="relative flex items-center gap-[8px] px-[6px] py-[3px] font-mono text-[11px]"
			title={`${entry.path}\nself ${entry.selfMs.toFixed(0)}ms · total ${entry.totalMs.toFixed(0)}ms · readdir ${entry.readdirMs.toFixed(0)}ms · ${entry.entryCount} entries · depth ${entry.depth}`}
		>
			<div
				className="absolute inset-y-0 left-0 rounded-sm bg-default/15"
				style={{ width: `${widthPct}%` }}
			/>
			<div className="relative w-[44px] shrink-0 text-right tabular-nums text-default">
				{entry.selfMs.toFixed(0)}ms
			</div>
			<div className="relative w-[52px] shrink-0 text-right tabular-nums text-muted">
				{entry.entryCount.toLocaleString()}
			</div>
			<div className="relative min-w-0 flex-1 truncate text-default">
				{display || "/"}
			</div>
		</div>
	);
};

function compactNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return n.toLocaleString();
}
