import React, { useMemo, useState } from "react";

import { sunburstColor } from "../../colors";
import { readableSize } from "../../util";

// The sunburst is built around a 600-unit square viewBox so the inner
// radii (70, 101, 132, …) can be reused as raw user-space numbers from
// the original canvas implementation. SVG centers via preserveAspectRatio.
const VIEW_HALF = 275;
const CENTER_R = 64;
const BASE_ANGLE_TURNS = 5 / 8;

type SunburstProps = {
	capacity: number;
	files: Ob.VfsNode[];
	size: number;
	position: number;
	rootSize: number;
	hueByName: Map<string, number>;
	onNavigateUp: () => void;
	onNavigateForward: (...into: string[]) => void;
};

type ShardEntry = {
	id: string;
	file: Ob.VfsNode;
	layer: number;
	position: number;
	size: number;
	hue: number;
	type: Ob.NodeType$;
	path: string[];
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

	const dark =
		typeof document !== "undefined" &&
		document.documentElement.classList.contains("dark");

	const shards = useMemo(
		() => buildShards(files, capacity, hueByName),
		[files, capacity, hueByName],
	);

	const clearHover = () => setHover(null);

	return (
		<div className="grow">
			<svg
				viewBox={`${-VIEW_HALF} ${-VIEW_HALF} ${VIEW_HALF * 2} ${VIEW_HALF * 2}`}
				className="h-full w-full"
				preserveAspectRatio="xMidYMid meet"
			>
				{shards.map((shard) => {
					if (hover?.shard.id === shard.id) return null;
					return renderShard(
						shard,
						dark,
						setHover,
						clearHover,
						onNavigateForward,
					);
				})}
				{/* Render the hovered shard last so its pulse animation paints on
				    top of neighboring strokes. */}
				{hover &&
					renderShard(
						hover.shard,
						dark,
						setHover,
						clearHover,
						onNavigateForward,
					)}

				<circle
					cx={0}
					cy={0}
					r={CENTER_R}
					fill="var(--color-ink)"
					style={{ cursor: "pointer" }}
					onClick={onNavigateUp}
				/>
				<text
					x={0}
					y={1}
					textAnchor="middle"
					dominantBaseline="middle"
					fill="var(--color-paper)"
					fontFamily="IBM Plex Mono, ui-monospace, monospace"
					fontSize={17}
					fontWeight={600}
					style={{ pointerEvents: "none" }}
				>
					{readableSize(size)}
				</text>
			</svg>

			{hover && (
				<Tooltip shard={hover.shard} x={hover.clientX} y={hover.clientY} />
			)}
		</div>
	);
};

type HoverState = {
	shard: ShardEntry;
	clientX: number;
	clientY: number;
};

function renderShard(
	shard: ShardEntry,
	dark: boolean,
	setHover: React.Dispatch<React.SetStateAction<HoverState | null>>,
	clearHover: () => void,
	onNavigateForward: (...into: string[]) => void,
): React.ReactNode {
	const { ir, or } = layerRadii(shard.layer);
	const fill = sunburstColor(shard.hue, shard.layer, shard.type, dark);
	const interactive = shard.type === "directory" || shard.type === "file";
	return (
		<path
			key={shard.id}
			d={arcPath(shard.position, shard.size, ir, or)}
			fill={fill}
			stroke="var(--color-paper)"
			strokeWidth={1.2}
			className="hover:pulse"
			style={{ cursor: interactive ? "pointer" : "default" }}
			onPointerEnter={(e) =>
				setHover({ shard, clientX: e.clientX, clientY: e.clientY })
			}
			onPointerMove={(e) =>
				setHover((prev) =>
					prev && prev.shard.id === shard.id
						? { ...prev, clientX: e.clientX, clientY: e.clientY }
						: prev,
				)
			}
			onPointerLeave={clearHover}
			onClick={() => {
				if (shard.type === "directory") {
					onNavigateForward(...shard.path);
				}
			}}
		/>
	);
}

type TooltipProps = {
	shard: ShardEntry;
	x: number;
	y: number;
};

const Tooltip: React.FC<TooltipProps> = ({ shard, x, y }) => {
	const top =
		shard.file.type === "directory" ? shard.file.files.slice(0, 7) : [];
	return (
		<div
			role="tooltip"
			className="pointer-events-none fixed min-w-[180px] z-10 rounded-card bg-ink px-4 py-3 text-[12px] text-paper shadow-menu"
			style={{ left: x + 15, top: y + 5 }}
		>
			<div className="flex justify-between gap-3">
				<span className="font-semibold">{shard.file.name}</span>
				<span className="ml-[14px] font-mono opacity-80">
					{readableSize(shard.file.size)}
				</span>
			</div>
			{top.length > 0 && (
				<ol className="mt-2">
					{top.map((file, i) => (
						<li
							key={`${file.name}-${i}`}
							className="flex justify-between gap-3 py-[2px] text-[11px]"
						>
							<span className="truncate">{file.name}</span>
							<span className="font-mono opacity-80">
								{readableSize(file.size)}
							</span>
						</li>
					))}
				</ol>
			)}
		</div>
	);
};

function buildShards(
	files: Ob.VfsNode[],
	capacity: number,
	hueByName: Map<string, number>,
): ShardEntry[] {
	const result: ShardEntry[] = [];
	const minImaginary = 0.003;

	const walk = (
		nodes: Ob.VfsNode[],
		layer: number,
		startPos: number,
		parentHue: number | null,
		parentPath: string[],
	): number => {
		let pos = startPos;
		for (const file of nodes) {
			const sliceSize = file.size / capacity;
			const myHue =
				layer === 0
					? (hueByName.get(file.name) ?? 0)
					: (parentHue ?? 0);
			const path = [...parentPath, file.name];
			result.push({
				id: `${layer}/${path.join("/")}`,
				file,
				layer,
				position: pos,
				size: sliceSize,
				hue: myHue,
				type: file.type,
				path,
			});

			if (file.type === "directory" && layer < 6 && file.files.length > 0) {
				const childEnd = walk(file.files, layer + 1, pos, myHue, path);
				const remainder = sliceSize - (childEnd - pos);
				if (layer < 4 && remainder > minImaginary) {
					result.push({
						id: `imaginary/${layer + 1}/${path.join("/")}`,
						file,
						layer: layer + 1,
						position: childEnd,
						size: remainder,
						hue: myHue,
						type: "imaginary",
						path,
					});
				}
			}

			pos += sliceSize;
		}
		return pos;
	};

	const totalEnd = walk(files, 0, 0, null, []);

	// Top-level imaginary remainder (small-items wedge at the inner ring).
	const totalUsed = files.reduce((sum, f) => sum + f.size, 0) / capacity;
	const remainder = totalUsed - totalEnd;
	if (remainder > minImaginary) {
		result.push({
			id: "imaginary/0",
			file: {
				type: "directory",
				name: "small items",
				size: 0,
				mtime: 0,
				files: [],
			},
			layer: 0,
			position: totalEnd,
			size: remainder,
			hue: 0,
			type: "imaginary",
			path: [],
		});
	}

	return result;
}

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
