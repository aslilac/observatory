import { Fragment } from "react";

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
	// When set, render a "Disks and folders › <view>" breadcrumb pattern. The
	// root crumb becomes inactive-clickable (hops home) and `view` is the
	// terminal active label. Used for the cleanup destination.
	view?: string;
};

export const Toolbar: React.FC<ToolbarProps> = ({
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
	view,
}) => {
	const inAScan = Boolean(root);
	const inView = Boolean(view);

	return (
		<div className="flex h-[44px] items-center gap-2 border-b border-line-soft px-3">
			<IconButton onClick={onBack} disabled={!canBack} title="Back">
				‹
			</IconButton>
			<IconButton onClick={onForward} disabled={!canForward} title="Forward">
				›
			</IconButton>
			<div className="mx-1 h-6 w-px bg-line" />
			<Crumb
				active={!inAScan && !inView}
				onClick={inAScan || inView ? onShowMenu : undefined}
			>
				Disks and folders
			</Crumb>
			{inView && (
				<>
					<Chevron />
					<Crumb active>{view}</Crumb>
				</>
			)}
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
				<Fragment key={i}>
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
				</Fragment>
			))}
			{scanning && <ScanningBadge />}
			<div className="flex-1" />
			{right}
			{chips}
		</div>
	);
};

const Chevron: React.FC = () => {
	return <span className="text-[12px] text-faint">›</span>;
};

const ScanningBadge: React.FC = () => (
	<span className="ml-1.5 flex items-center gap-1.5 font-mono text-[11px] text-muted">
		<span className="block size-1.5 animate-pulse rounded-full bg-default" />
		scanning
	</span>
);

type CrumbProps = {
	children: React.ReactNode;
	active?: boolean;
	onClick?: () => void;
};

const Crumb: React.FC<CrumbProps> = ({ children, active, onClick }) => (
	<button
		type="button"
		onClick={onClick}
		disabled={!onClick}
		className={`rounded-button px-2.5 py-1 text-[12px] disabled:cursor-default ${
			active
				? "bg-fill font-semibold text-default"
				: "bg-transparent font-medium text-muted enabled:hover:bg-fill enabled:hover:text-default"
		}`}
	>
		{children}
	</button>
);

type IconButtonProps = {
	children: React.ReactNode;
	onClick?: () => void;
	active?: boolean;
	disabled?: boolean;
	title?: string;
};

const IconButton: React.FC<IconButtonProps> = ({
	children,
	onClick,
	active,
	disabled,
	title,
}) => (
	<button
		type="button"
		onClick={onClick}
		disabled={disabled}
		title={title}
		className={`
			inline-flex size-[26px] cursor-pointer items-center justify-center rounded-button border border-line bg-transparent p-0 text-[14px] text-default hover:bg-fill
			${active ? "border-default bg-fill" : ""}
			${disabled ? "cursor-default opacity-40" : ""}
		`}
	>
		{children}
	</button>
);

type SegmentedProps<T extends string> = {
	value: T;
	options: ReadonlyArray<{ value: T; label: string; icon?: React.ReactNode }>;
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
					title={o.label}
					className={`inline-flex cursor-pointer items-center gap-[6px] rounded-[5px] border-0 px-[10px] py-[3px] text-[11px] ${
						value === o.value
							? "bg-background font-semibold text-default shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
							: "bg-transparent font-medium text-muted"
					}`}
				>
					{o.icon}
					{o.label}
				</button>
			))}
		</div>
	);
}
