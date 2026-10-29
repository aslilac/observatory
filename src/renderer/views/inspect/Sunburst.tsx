import { useMemo, useState } from "react";
import { isDarkTheme } from "#/colors";
import { rowActions } from "#/contextActions";
import { readableSize } from "#/format";
import { useCleanupQueue } from "#/state";
import { AreaMenu } from "#/components/ContextMenu";
import { startCleanupDrag } from "../cleanup/cleanupDrag";
import type { ReservedGroup } from "./reserved";
import { layoutWedges, type Wedge } from "./sunburstLayout";
import { useSunburstTransition, wedgePath } from "./sunburstTransition";
import type { SelectableItem } from "./types";

const VIEW_RADIUS = 275;
const CENTER_R = 64;

type HoverState = {
	id: string;
	file: Ob.VfsNode;
	// Set when it's a file or folder's own wedge, rather than reserved space or
	// the rest of a folder: what its menu and dragging it act on.
	item?: SelectableItem;
	// Set when it's one of the reserved wedges, which `file` only names.
	reserved?: ReservedGroup;
	clientX: number;
	clientY: number;
};

type SunburstProps = {
	/**
	 * The capacity in bytes of the storage device, if the root of the scan is a
	 * drive.
	 */
	capacity: number;
	/** The size in bytes of the root directory. */
	rootSize: number;
	/** The size of the current directory. */
	size: number;
	/** The contents of the current directory. */
	files: Ob.VfsNode[];
	/**
	 * The starting position of the current directory as a fraction of
	 * `rootSize`, relative to the beginning of the scan, ordered by largest
	 * children first. ie. The largest child of the scan root has a position of
	 * 0, the second largest has a position equal to the share of the largest,
	 * the third largest has a position equal to the share of the largest plus
	 * the second largest, and so on. The largest child of a subdirectory has
	 * the same position as the subdirectory itself.
	 *
	 * This is all just used for elaborate color math: see `hueForRange`.
	 */
	position: number;
	/**
	 * What Windows keeps for itself, which isn't in `size`: drawn in the
	 * innermost ring after the files, before the free space.
	 */
	reserved: ReservedGroup[];
	/** The path of the scan root. */
	root: string;
	/**
	 * Where the current directory is below the scan root: the cursor of the
	 * render tree `files` came from, which can lag behind the navigation's
	 * while the next one loads. Its length is the absolute depth that
	 * lightness is keyed on, so, like hue, a node's color doesn't change as
	 * the user navigates.
	 */
	cursor: string[];

	onNavigateUp: () => void;
	onNavigateForward: (...into: string[]) => void;
	onMoveToCleanup: (item: SelectableItem) => void;
};

export const Sunburst: React.FC<SunburstProps> = ({
	capacity,
	files,
	size,
	position,
	rootSize,
	reserved,
	root,
	cursor,
	onNavigateUp,
	onNavigateForward,
	onMoveToCleanup,
}) => {
	const [hover, setHover] = useState<HoverState | null>(null);
	const { includes: inCleanup } = useCleanupQueue();
	const dark = isDarkTheme();

	const wedges = useMemo(
		() =>
			layoutWedges({
				root,
				cursor,
				files,
				capacity,
				size,
				rootSize,
				position,
				reserved,
				dark,
			}),
		[root, cursor, files, capacity, size, rootSize, position, reserved, dark],
	);
	const { ghosts, bind, bindGhost } = useSunburstTransition(
		{ root, cursor, span: capacity > 0 ? size / capacity : 0 },
		wedges,
	);

	const handleNavigateForward = (...into: string[]) => {
		onNavigateForward(...into);
		setHover(null);
	};

	return (
		<AreaMenu
			className="grow"
			itemsHere={() =>
				hover?.item ? rowActions(hover.item, onMoveToCleanup) : null
			}
			draggable
			onDragStart={(e) => {
				if (!hover?.item) {
					e.preventDefault();
					return;
				}
				startCleanupDrag(e, [hover.item]);
				setHover(null);
			}}
		>
			<svg
				viewBox={`${-VIEW_RADIUS} ${-VIEW_RADIUS} ${VIEW_RADIUS * 2} ${VIEW_RADIUS * 2}`}
				className="size-full"
				preserveAspectRatio="xMidYMid meet"
			>
				<g style={{ pointerEvents: "none" }}>
					{ghosts.map((ghost) => (
						<path
							key={ghost.key}
							ref={bindGhost(ghost.key)}
							d={wedgePath(ghost.from.arc)}
							opacity={ghost.from.opacity}
							fill={ghost.fill}
							stroke="var(--color-background)"
							strokeWidth={0.9}
						/>
					))}
				</g>
				<g>
					{wedges.map((wedge) => (
						<Shard
							key={wedge.key}
							wedge={wedge}
							bind={bind(wedge.key)}
							queued={
								wedge.cleanupPath !== undefined && inCleanup(wedge.cleanupPath)
							}
							hovered={hover?.id === wedge.key}
							setHover={setHover}
							onNavigateForward={handleNavigateForward}
						/>
					))}
				</g>
				<circle
					cx={0}
					cy={0}
					r={CENTER_R}
					fill="var(--color-default)"
					style={{ cursor: "pointer" }}
					onClick={onNavigateUp}
				/>
				<text
					x={0}
					y={1}
					textAnchor="middle"
					dominantBaseline="middle"
					fill="var(--color-background)"
					className="tabular-nums"
					fontSize={17}
					fontWeight={600}
					style={{ pointerEvents: "none" }}
				>
					{readableSize(size)}
				</text>
			</svg>

			{hover && (
				<Tooltip
					file={hover.file}
					reserved={hover.reserved}
					x={hover.clientX}
					y={hover.clientY}
				/>
			)}
		</AreaMenu>
	);
};

type ShardProps = {
	wedge: Wedge;
	bind: (el: SVGPathElement | null) => void;
	// In cleanup, or inside a folder that is: drawn faded.
	queued: boolean;
	hovered: boolean;
	setHover: React.Dispatch<React.SetStateAction<HoverState | null>>;
	onNavigateForward: (...into: string[]) => void;
};

const Shard: React.FC<ShardProps> = ({
	wedge,
	bind,
	queued,
	hovered,
	setHover,
	onNavigateForward,
}) => {
	const { key, file, item, reserved, type, path } = wedge;
	const interactive = type === "directory" || type === "file";
	const hoverAt = (e: React.PointerEvent) =>
		setHover({
			id: key,
			file,
			item,
			reserved,
			clientX: e.clientX,
			clientY: e.clientY,
		});
	return (
		<path
			ref={bind}
			d={wedgePath(wedge.arc)}
			fill={wedge.fill}
			stroke="var(--color-background)"
			strokeWidth={0.9}
			fillOpacity={queued ? 0.3 : undefined}
			className={hovered ? "pulse" : undefined}
			style={{ cursor: interactive ? "pointer" : "default" }}
			onPointerOver={hoverAt}
			onPointerMove={hoverAt}
			onPointerLeave={() =>
				setHover((prev) => (prev?.id === key ? null : prev))
			}
			onClick={() => {
				if (type === "directory") {
					onNavigateForward(...path);
				}
			}}
		/>
	);
};

type TooltipProps = {
	file: Ob.VfsNode;
	reserved?: ReservedGroup;
	x: number;
	y: number;
};

const Tooltip: React.FC<TooltipProps> = ({ file, reserved, x, y }) => {
	const top = file.type === "directory" ? file.files.slice(0, 7) : [];
	return (
		<div
			role="tooltip"
			className="pointer-events-none fixed z-10 min-w-[180px] rounded-card bg-default px-4 py-3 text-[12px] text-background shadow-menu"
			style={{ left: x + 15, top: y + 5 }}
		>
			<div className="flex justify-between gap-3">
				<span className="font-semibold">{file.name}</span>
				<span className="ml-[14px] tabular-nums opacity-80">
					{readableSize(file.size)}
				</span>
			</div>
			{reserved && (
				<div className="mt-2 max-w-[260px] text-[11px]">
					<div className="opacity-80">{reserved.names.join(", ")}</div>
					<div className="mt-1">{reserved.hint}</div>
				</div>
			)}
			{top.length > 0 && (
				<ol className="mt-2">
					{top.map((child, i) => (
						<li
							key={`${child.name}-${i}`}
							className="flex justify-between gap-3 py-[2px] text-[11px]"
						>
							<span className="truncate">{child.name}</span>
							<span className="tabular-nums opacity-80">
								{readableSize(child.size)}
							</span>
						</li>
					))}
				</ol>
			)}
		</div>
	);
};
