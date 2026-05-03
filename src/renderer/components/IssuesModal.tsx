import React, { useMemo } from "react";

import { Button } from "./Button";

type IssuesModalProps = {
	errors: Ob.ScanError[];
	onClose: () => void;
};

const KIND_LABEL: Record<Ob.ScanError["kind"], string> = {
	permission: "Permission denied",
	missing: "Missing entries",
	loop: "Symlink loops",
	other: "Other errors",
};

const KIND_ORDER: Array<Ob.ScanError["kind"]> = [
	"permission",
	"missing",
	"loop",
	"other",
];

export const IssuesModal: React.FC<IssuesModalProps> = ({ errors, onClose }) => {
	const grouped = useMemo(() => {
		const buckets = new Map<Ob.ScanError["kind"], Ob.ScanError[]>();
		for (const e of errors) {
			const list = buckets.get(e.kind) ?? [];
			list.push(e);
			buckets.set(e.kind, list);
		}
		return buckets;
	}, [errors]);

	return (
		<div
			className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(0,0,0,0.32)]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				className="w-[560px] rounded-modal bg-background p-[24px] [box-shadow:var(--shadow-modal)]"
				role="dialog"
				aria-modal="true"
			>
				<div className="mb-[16px] flex items-baseline justify-between">
					<div>
						<div className="text-[16px] font-semibold">Scan issues</div>
						<div className="font-mono text-[11px] text-muted">
							{errors.length} entr{errors.length === 1 ? "y" : "ies"} skipped or
							unreadable
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="cursor-pointer text-[18px] leading-none text-faint hover:text-default"
					>
						×
					</button>
				</div>

				<div className="max-h-[400px] overflow-auto rounded-card border border-line-soft">
					{KIND_ORDER.filter((k) => grouped.has(k)).map((kind, idx, arr) => {
						const list = grouped.get(kind)!;
						return (
							<div
								key={kind}
								className={
									idx < arr.length - 1 ? "border-b border-line-soft" : ""
								}
							>
								<div className="flex items-baseline justify-between bg-fill px-[12px] py-[6px]">
									<div className="text-[12px] font-semibold">
										{KIND_LABEL[kind]}
									</div>
									<div className="font-mono text-[11px] text-muted">
										{list.length}
									</div>
								</div>
								<div>
									{list.slice(0, 50).map((err, i) => (
										<div
											key={`${err.path}-${i}`}
											className="px-[12px] py-[5px] text-[11px]"
										>
											<div
												className="truncate font-mono text-default"
												title={err.path}
											>
												{err.path}
											</div>
											<div className="truncate font-mono text-[10px] text-muted">
												{err.code ? `${err.code} · ` : ""}
												{err.message}
											</div>
										</div>
									))}
									{list.length > 50 && (
										<div className="px-[12px] py-[6px] font-mono text-[10px] text-muted">
											… {list.length - 50} more not shown
										</div>
									)}
								</div>
							</div>
						);
					})}
				</div>

				<div className="mt-[20px] flex justify-end">
					<Button variant="primary" onClick={onClose}>
						Close
					</Button>
				</div>
			</div>
		</div>
	);
};
