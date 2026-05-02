import React from "react";

type ToolbarProps = {
	root?: string;
	cursor?: string[];
	onShowMenu?: () => void;
	onCursor?: (next: string[]) => void;
	right?: React.ReactNode;
	scanning?: boolean;
	canBack?: boolean;
	canForward?: boolean;
	onBack?: () => void;
	onForward?: () => void;
	chips?: React.ReactNode;
};

export const Toolbar = ({
	root,
	cursor = [],
	onShowMenu,
	onCursor,
	right,
	scanning,
	canBack,
	canForward,
	onBack,
	onForward,
	chips,
}: ToolbarProps) => {
	const inAScan = !!root;
	return (
		<div className="flex h-[44px] items-center gap-2 border-b border-line-soft px-[14px]">
			<IconBtn onClick={onBack} disabled={!canBack} title="Back">
				‹
			</IconBtn>
			<IconBtn onClick={onForward} disabled={!canForward} title="Forward">
				›
			</IconBtn>
			<div className="mx-1 h-[18px] w-px bg-line" />
			<Crumb
				active={!inAScan}
				onClick={inAScan ? onShowMenu : undefined}
			>
				Disks and folders
			</Crumb>
			{inAScan && (
				<>
					<Chevron />
					<Crumb
						active={cursor.length === 0}
						onClick={cursor.length > 0 ? () => onCursor?.([]) : undefined}
					>
						{root}
					</Crumb>
				</>
			)}
			{cursor.map((piece, i) => (
				<React.Fragment key={i}>
					<Chevron />
					<Crumb
						active={i === cursor.length - 1}
						onClick={
							i < cursor.length - 1
								? () => onCursor?.(cursor.slice(0, i + 1))
								: undefined
						}
					>
						{piece}
					</Crumb>
				</React.Fragment>
			))}
			{scanning && <ScanningBadge />}
			<div className="flex-1" />
			{right}
			{chips}
		</div>
	);
};

const Chevron = () => <span className="text-[12px] text-faint">›</span>;

const ScanningBadge = () => (
	<span className="ml-[6px] flex items-center gap-[6px] font-mono text-[11px] text-muted">
		<span className="block h-[6px] w-[6px] animate-pulse rounded-full bg-ink" />
		scanning
	</span>
);

type CrumbProps = {
	children: React.ReactNode;
	active?: boolean;
	onClick?: () => void;
};

const Crumb = ({ children, active, onClick }: CrumbProps) => (
	<button
		type="button"
		onClick={onClick}
		disabled={!onClick}
		className={`rounded-button px-[10px] py-[4px] text-[12px] disabled:cursor-default ${
			active
				? "bg-fill font-semibold text-ink"
				: "bg-transparent font-medium text-muted enabled:hover:bg-fill enabled:hover:text-ink"
		}`}
	>
		{children}
	</button>
);

type IconBtnProps = {
	children: React.ReactNode;
	onClick?: () => void;
	active?: boolean;
	disabled?: boolean;
	title?: string;
};

const IconBtn = ({ children, onClick, active, disabled, title }: IconBtnProps) => (
	<button
		type="button"
		onClick={onClick}
		disabled={disabled}
		title={title}
		className={`icon-btn ${active ? "icon-btn-active" : ""} ${
			disabled ? "cursor-default opacity-40" : ""
		}`}
	>
		{children}
	</button>
);

type SegmentedProps<T extends string> = {
	value: T;
	options: ReadonlyArray<{ value: T; label: string }>;
	onChange: (next: T) => void;
};

export function Segmented<T extends string>({
	value,
	options,
	onChange,
}: SegmentedProps<T>) {
	return (
		<div className="inline-flex rounded-[7px] border border-line bg-fill p-[2px]">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					onClick={() => onChange(o.value)}
					className={`cursor-pointer rounded-[5px] border-0 px-[12px] py-[3px] text-[11px] ${
						value === o.value
							? "bg-paper font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
							: "bg-transparent font-medium text-muted"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

