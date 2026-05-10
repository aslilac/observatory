import { useState } from "react";

import { sunburstColor } from "../../colors";
import { readableSize } from "../../util";

const VIEW_RADIUS = 275;
const CENTER_R = 64;
const BASE_ANGLE_TURNS = 5 / 8;
const MIN_IMAGINARY = 0.003;
const MAX_LAYER = 6;

type HoverState = {
	id: string;
	file: Ob.VfsNode;
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
	 * The starting position of the current directory in bytes, relative to
	 * beginning of the scan, ordered by largest children first. ie. The largest
	 * largest child of the scan root has a position of 0, the second largest
	 * has a position equal to the size of the largest, the third largest has a
	 * position equal to the size of the largest plus the second largest, and so
	 * on. The largest child of subdirectories will be the same as the parent
	 * directory.
	 *
	 * This is all just used for elaborate color math.
	 */
	position: number;

	hueByName: Map<string, number>;
	onNavigateUp: () => void;
	onNavigateForward: (...into: string[]) => void;
};

export const Sunburst: React.FC<SunburstProps> = ({
	capacity,
	files,
	size,
	hueByName,
	onNavigateUp,
	onNavigateForward,
}) => {
	const [hover, setHover] = useState<HoverState | null>(null);

	const handleNavigateForward = (...into: string[]) => {
		onNavigateForward(...into);
		setHover(null);
	};

	const dark =
		typeof document !== "undefined" &&
		document.documentElement.classList.contains("dark");

	const usedFraction = files.reduce((s, f) => s + f.size, 0) / capacity;
	const freeRemainder = 1 - usedFraction;

	return (
		<div className="grow">
			<svg
				viewBox={`${-VIEW_RADIUS} ${-VIEW_RADIUS} ${VIEW_RADIUS * 2} ${VIEW_RADIUS * 2}`}
				className="h-full w-full"
				preserveAspectRatio="xMidYMid meet"
			>
				<ShardTree
					nodes={files}
					layer={0}
					startPos={0}
					parentHue={null}
					parentPath={[]}
					capacity={capacity}
					hueByName={hueByName}
					hover={hover}
					setHover={setHover}
					dark={dark}
					onNavigateForward={handleNavigateForward}
				/>
				{freeRemainder > MIN_IMAGINARY && (
					<Shard
						id="imaginary/0"
						file={IMAGINARY_FILE}
						layer={0}
						position={usedFraction}
						size={freeRemainder}
						hue={0}
						type="imaginary"
						path={[]}
						hovered={false}
						dark={dark}
						setHover={setHover}
						onNavigateForward={handleNavigateForward}
					/>
				)}
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
					fontFamily="IBM Plex Mono, ui-monospace, monospace"
					fontSize={17}
					fontWeight={600}
					style={{ pointerEvents: "none" }}
				>
					{readableSize(size)}
				</text>
			</svg>

			{hover && (
				<Tooltip file={hover.file} x={hover.clientX} y={hover.clientY} />
			)}
		</div>
	);
};

type ShardTreeProps = {
	nodes: Ob.VfsNode[];
	layer: number;
	startPos: number;
	parentHue: number | null;
	parentPath: string[];
	capacity: number;
	hueByName: Map<string, number>;
	hover: HoverState | null;
	setHover: React.Dispatch<React.SetStateAction<HoverState | null>>;
	dark: boolean;
	onNavigateForward: (...into: string[]) => void;
};

const ShardTree: React.FC<ShardTreeProps> = ({
	nodes,
	layer,
	startPos,
	parentHue,
	parentPath,
	capacity,
	hueByName,
	hover,
	setHover,
	dark,
	onNavigateForward,
}) => {
	const elements: React.ReactNode[] = [];
	let pos = startPos;
	for (const file of nodes) {
		const sliceSize = file.size / capacity;
		const myHue =
			layer === 0 ? (hueByName.get(file.name) ?? 0) : (parentHue ?? 0);
		const path = [...parentPath, file.name];
		const id = `${layer}/${path.join("/")}`;

		elements.push(
			<Shard
				key={id}
				id={id}
				file={file}
				layer={layer}
				position={pos}
				size={sliceSize}
				hue={myHue}
				type={file.type}
				path={path}
				hovered={hover?.id === id}
				dark={dark}
				setHover={setHover}
				onNavigateForward={onNavigateForward}
			/>,
		);

		if (
			file.type === "directory" &&
			layer < MAX_LAYER &&
			file.files.length > 0
		) {
			elements.push(
				<ShardTree
					key={`${id}/children`}
					nodes={file.files}
					layer={layer + 1}
					startPos={pos}
					parentHue={myHue}
					parentPath={path}
					capacity={capacity}
					hueByName={hueByName}
					hover={hover}
					setHover={setHover}
					dark={dark}
					onNavigateForward={onNavigateForward}
				/>,
			);

			const childrenSum = file.files.reduce((s, f) => s + f.size, 0) / capacity;
			const remainder = sliceSize - childrenSum;
			if (layer < 4 && remainder > MIN_IMAGINARY) {
				const remainderId = `imaginary/${layer + 1}/${path.join("/")}`;
				elements.push(
					<Shard
						key={remainderId}
						id={remainderId}
						file={file}
						layer={layer + 1}
						position={pos + childrenSum}
						size={remainder}
						hue={myHue}
						type="imaginary"
						path={path}
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
	layer: number;
	position: number;
	size: number;
	hue: number;
	type: Ob.NodeType$;
	path: string[];
	hovered: boolean;
	dark: boolean;
	setHover: React.Dispatch<React.SetStateAction<HoverState | null>>;
	onNavigateForward: (...into: string[]) => void;
};

const Shard: React.FC<ShardProps> = ({
	id,
	file,
	layer,
	position,
	size,
	hue,
	type,
	path,
	hovered,
	dark,
	setHover,
	onNavigateForward,
}) => {
	const { ir, or } = layerRadii(layer);
	const fill = sunburstColor(hue, layer, type, dark);
	const interactive = type === "directory" || type === "file";
	return (
		<path
			d={arcPath(position, size, ir, or)}
			fill={fill}
			stroke="var(--color-background)"
			strokeWidth={1.2}
			className={hovered ? "pulse" : undefined}
			style={{ cursor: interactive ? "pointer" : "default" }}
			onPointerOver={(e) =>
				setHover({ id, file, clientX: e.clientX, clientY: e.clientY })
			}
			onPointerMove={(e) =>
				setHover({ id, file, clientX: e.clientX, clientY: e.clientY })
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
	x: number;
	y: number;
};

const Tooltip: React.FC<TooltipProps> = ({ file, x, y }) => {
	const top = file.type === "directory" ? file.files.slice(0, 7) : [];
	return (
		<div
			role="tooltip"
			className="pointer-events-none fixed min-w-[180px] z-10 rounded-card bg-default px-4 py-3 text-[12px] text-background shadow-menu"
			style={{ left: x + 15, top: y + 5 }}
		>
			<div className="flex justify-between gap-3">
				<span className="font-semibold">{file.name}</span>
				<span className="ml-[14px] font-mono opacity-80">
					{readableSize(file.size)}
				</span>
			</div>
			{top.length > 0 && (
				<ol className="mt-2">
					{top.map((child, i) => (
						<li
							key={`${child.name}-${i}`}
							className="flex justify-between gap-3 py-[2px] text-[11px]"
						>
							<span className="truncate">{child.name}</span>
							<span className="font-mono opacity-80">
								{readableSize(child.size)}
							</span>
						</li>
					))}
				</ol>
			)}
		</div>
	);
};

const IMAGINARY_FILE: Ob.VfsDirectory = {
	type: "directory",
	name: "small items",
	size: 0,
	mtime: 0,
	files: [],
};

// Layer ring geometry mirrors the original canvas widths: five 31-unit
// inner rings followed by tighter 5-unit outer rings for deep hierarchies.
function layerRadii(layer: number): { ir: number; or: number } {
	if (layer > 4) {
		const ir = 228 + 8 * (layer - 5);
		return { ir, or: ir + 5 };
	}
	const ir = 70 + 31 * layer;
	return { ir, or: ir + 31 };
}

// Build the SVG `d` attribute for one wedge of an annulus (donut slice).
//
// Inputs are in "turns" of a unit circle so the rest of the file can stay in
// fractional-of-total terms:
//
//   position  cumulative offset of this wedge's start, 0..1
//   size      angular width of this wedge, 0..1
//   ir, or    inner / outer radius in viewBox units
//
// `a` and `b` are the start and end angles in radians, rotated by
// BASE_ANGLE_TURNS so the 0-position lands where the design wants it (5/8
// of the way around, i.e. roughly the top-left). The `largeArc` flag is
// SVG's way of disambiguating arcs over 180°: 0 picks the short way, 1
// picks the long way. We need it set for any single wedge that wraps more
// than half the circle.
//
// The outline is built outer-arc clockwise, then radially in to the inner
// circle, then inner-arc counter-clockwise (sweep-flag 0) back to the
// starting angle, then closed:
//
//       (ox1,oy1) ─→ outer arc ─→ (ox2,oy2)
//          ↑                          ↓
//       (ix1,iy1) ←─ inner arc ←─ (ix2,iy2)
function arcPath(
	position: number,
	size: number,
	ir: number,
	or: number,
): string {
	const a = (BASE_ANGLE_TURNS + position) * Math.PI * 2;
	const b = (BASE_ANGLE_TURNS + position + size) * Math.PI * 2;
	const largeArc = b - a > Math.PI ? 1 : 0;

	// Outer ring endpoints
	const ox1 = (or * Math.cos(a)).toFixed(2);
	const oy1 = (or * Math.sin(a)).toFixed(2);
	const ox2 = (or * Math.cos(b)).toFixed(2);
	const oy2 = (or * Math.sin(b)).toFixed(2);
	// Inner ring endpoints
	const ix1 = (ir * Math.cos(a)).toFixed(2);
	const iy1 = (ir * Math.sin(a)).toFixed(2);
	const ix2 = (ir * Math.cos(b)).toFixed(2);
	const iy2 = (ir * Math.sin(b)).toFixed(2);

	return [
		`M ${ox1} ${oy1}`,
		`A ${or} ${or} 0 ${largeArc} 1 ${ox2} ${oy2}`,
		`L ${ix2} ${iy2}`,
		`A ${ir} ${ir} 0 ${largeArc} 0 ${ix1} ${iy1}`,
		"Z",
	].join(" ");
}
