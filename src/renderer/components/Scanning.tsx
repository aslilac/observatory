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
			</div>
		</>
	);
};

function compactNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return n.toLocaleString();
}
