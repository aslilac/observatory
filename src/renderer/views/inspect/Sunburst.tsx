import { useState } from "react";
import { hueForRange, isDarkTheme, sunburstColor } from "#/colors";
import { rowActions } from "#/contextActions";
import { readableSize } from "#/format";
import { joinPath } from "#/paths";
import { useCleanupQueue } from "#/state";
import { AreaMenu } from "#/components/ContextMenu";
import { startCleanupDrag } from "../cleanup/cleanupDrag";
import type { ReservedGroup } from "./reserved";
import { arcPath, isDrawable, layerRadii } from "./sunburstGeometry";
import type { SelectableItem } from "./types";

const VIEW_RADIUS = 275;
const CENTER_R = 64;
const MAX_LAYER = 6;

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
	 * How many levels below the scan root the current directory sits (the
	 * cursor length). Lightness is keyed on absolute depth so, like hue, a
	 * node's color doesn't change as the user navigates.
	 */
	depth: number;
	/**
	 * What Windows keeps for itself, which isn't in `size`: drawn in the
	 * innermost ring after the files, before the free space.
	 */
	reserved: ReservedGroup[];
	/** Where the current directory is, which the wedges' paths go on. */
	path: string;

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
	depth,
	reserved,
	path,
	onNavigateUp,
	onNavigateForward,
	onMoveToCleanup,
}) => {
	const [hover, setHover] = useState<HoverState | null>(null);
	const { includes: inCleanup } = useCleanupQueue();

	const handleNavigateForward = (...into: string[]) => {
		onNavigateForward(...into);
		setHover(null);
	};

	const dark = isDarkTheme();

	const reservedShards: React.ReactNode[] = [];
	let reservedPos = size / capacity;
	for (const group of reserved) {
		// Kept inside the circle should the capacity be unknown.
		const share = Math.min(group.size / capacity, 1 - reservedPos);
		if (isDrawable(share, 0)) {
			const id = `reserved/${group.kind}`;
			reservedShards.push(
				<Shard
					key={id}
					id={id}
					file={{ type: "file", name: group.label, size: group.size, mtime: 0 }}
					reserved={group}
					layer={0}
					depth={depth}
					position={reservedPos}
					size={share}
					hue={0}
					type="reserved"
					path={[]}
					item={undefined}
					queued={false}
					hovered={hover?.id === id}
					dark={dark}
					setHover={setHover}
					onNavigateForward={handleNavigateForward}
				/>,
			);
		}
		reservedPos += share;
	}

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
				<ShardTree
					nodes={files}
					layer={0}
					depth={depth}
					startPos={0}
					hueStart={position}
					parentPath={[]}
					basePath={path}
					inCleanup={inCleanup}
					capacity={capacity}
					rootSize={rootSize}
					hover={hover}
					setHover={setHover}
					dark={dark}
					onNavigateForward={handleNavigateForward}
				/>
				{reservedShards}
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

type ShardTreeProps = {
	nodes: Ob.VfsNode[];
	layer: number;
	// Absolute depth of layer 0 (the current directory's children).
	depth: number;
	startPos: number;
	// Where this run of siblings starts in hue space, as a fraction of
	// rootSize. Tracked separately from startPos because the arc geometry is
	// scaled to the current directory's capacity while hues stay anchored to
	// the scan root.
	hueStart: number;
	parentPath: string[];
	// Where the current directory is, which parentPath goes on.
	basePath: string;
	inCleanup: (path: string) => boolean;
	capacity: number;
	rootSize: number;
	hover: HoverState | null;
	setHover: React.Dispatch<React.SetStateAction<HoverState | null>>;
	dark: boolean;
	onNavigateForward: (...into: string[]) => void;
};

const ShardTree: React.FC<ShardTreeProps> = ({
	nodes,
	layer,
	depth,
	startPos,
	hueStart,
	parentPath,
	basePath,
	inCleanup,
	capacity,
	rootSize,
	hover,
	setHover,
	dark,
	onNavigateForward,
}) => {
	const elements: React.ReactNode[] = [];
	let pos = startPos;
	let huePos = hueStart;
	for (const file of nodes) {
		const sliceSize = file.size / capacity;
		const hueSize = file.size / rootSize;
		// Hues follow every sibling's bytes, drawn or not, to match the legend.
		const fileHuePos = huePos;
		huePos += hueSize;
		if (!isDrawable(sliceSize, layer)) {
			continue;
		}
		const myHue = hueForRange(fileHuePos, hueSize);
		const path = [...parentPath, file.name];
		const id = `${layer}/${path.join("/")}`;
		const fullPath = joinPath(basePath, ...path);
		const item: SelectableItem = {
			path: fullPath,
			name: file.name,
			size: file.size,
			type: file.type === "directory" ? "directory" : "file",
		};
		const queued = inCleanup(fullPath);

		elements.push(
			<Shard
				key={id}
				id={id}
				file={file}
				layer={layer}
				depth={depth + layer}
				position={pos}
				size={sliceSize}
				hue={myHue}
				type={file.type}
				path={path}
				item={item}
				queued={queued}
				hovered={hover?.id === id}
				dark={dark}
				setHover={setHover}
				onNavigateForward={onNavigateForward}
			/>,
		);

		if (file.type === "directory" && layer < MAX_LAYER) {
			if (file.files.length > 0) {
				elements.push(
					<ShardTree
						key={`${id}/children`}
						nodes={file.files}
						layer={layer + 1}
						depth={depth}
						startPos={pos}
						hueStart={fileHuePos}
						parentPath={path}
						basePath={basePath}
						inCleanup={inCleanup}
						capacity={capacity}
						rootSize={rootSize}
						hover={hover}
						setHover={setHover}
						dark={dark}
						onNavigateForward={onNavigateForward}
					/>,
				);
			}

			// The rest of the directory goes in one gray wedge: children too
			// small to draw, whether they were dropped here or by the scanner
			// (src/scanner/tree.rs), which leaves no trace of them.
			const childrenSum = file.files
				.map((f) => f.size / capacity)
				.filter((s) => isDrawable(s, layer + 1))
				.reduce((sum, s) => sum + s, 0);
			const remainder = sliceSize - childrenSum;
			if (layer < 4 && isDrawable(remainder, layer + 1)) {
				const remainderId = `imaginary/${layer + 1}/${path.join("/")}`;
				elements.push(
					<Shard
						key={remainderId}
						id={remainderId}
						file={file}
						layer={layer + 1}
						depth={depth + layer + 1}
						position={pos + childrenSum}
						size={remainder}
						hue={myHue}
						type="imaginary"
						path={path}
						item={undefined}
						queued={queued}
						hovered={hover?.id === remainderId}
						dark={dark}
						setHover={setHover}
						onNavigateForward={onNavigateForward}
					/>,
				);
			}
		}

		pos += sliceSize;
	}
	return <>{elements}</>;
};

type ShardProps = {
	id: string;
	file: Ob.VfsNode;
	reserved?: ReservedGroup;
	// Ring index in the current view (geometry) vs. depth below the scan
	// root (color).
	layer: number;
	depth: number;
	position: number;
	size: number;
	hue: number;
	type: Ob.NodeType$;
	path: string[];
	item: SelectableItem | undefined;
	// In cleanup, or inside a folder that is: drawn faded.
	queued: boolean;
	hovered: boolean;
	dark: boolean;
	setHover: React.Dispatch<React.SetStateAction<HoverState | null>>;
	onNavigateForward: (...into: string[]) => void;
};

const Shard: React.FC<ShardProps> = ({
	id,
	file,
	reserved,
	layer,
	depth,
	position,
	size,
	hue,
	type,
	path,
	item,
	queued,
	hovered,
	dark,
	setHover,
	onNavigateForward,
}) => {
	const { ir, or } = layerRadii(layer);
	const fill = sunburstColor(hue, depth, type, dark);
	const interactive = type === "directory" || type === "file";
	return (
		<path
			d={arcPath(position, size, ir, or)}
			fill={fill}
			stroke="var(--color-background)"
			strokeWidth={0.9}
			fillOpacity={queued ? 0.3 : undefined}
			className={hovered ? "pulse" : undefined}
			style={{ cursor: interactive ? "pointer" : "default" }}
			onPointerOver={(e) =>
				setHover({
					id,
					file,
					item,
					reserved,
					clientX: e.clientX,
					clientY: e.clientY,
				})
			}
			onPointerMove={(e) =>
				setHover({
					id,
					file,
					item,
					reserved,
					clientX: e.clientX,
					clientY: e.clientY,
				})
			}
			onPointerLeave={() => setHover((prev) => (prev?.id === id ? null : prev))}
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
