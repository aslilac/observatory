import React, { useMemo, useState } from "react";

import { hueFor, sunburstColor } from "../../colors";
import { readableSize } from "../../util";

// The sunburst is built around a 600-unit square viewBox so the inner
// radii (70, 101, 132, …) can be reused as raw user-space numbers from
// the original canvas implementation. SVG centers via preserveAspectRatio.
const VIEW_HALF = 300;
const CENTER_R = 64;
const BASE_ANGLE_TURNS = 5 / 8;

type SunburstProps = {
	capacity: number;
	files: Ob.VfsNode[];
	size: number;
	position: number;
	rootSize: number;
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

export const Sunburst = ({
	capacity,
	files,
	size,
	onNavigateUp,
	onNavigateForward,
}: SunburstProps) => {
	const [hover, setHover] = useState<HoverState | null>(null);

	const dark =
		typeof document !== "undefined" &&
		document.documentElement.classList.contains("dark");

	const shards = useMemo(
		() => buildShards(files, capacity),
		[files, capacity],
	);

	const clearHover = () => setHover(null);

	return (
		<div className="relative h-full w-full" onMouseLeave={clearHover}>
			<svg
				viewBox={`${-VIEW_HALF} ${-VIEW_HALF} ${VIEW_HALF * 2} ${VIEW_HALF * 2}`}
				className="h-full w-full select-none"
				preserveAspectRatio="xMidYMid meet"
			>
				{shards.map((shard) => {
					if (hover?.shard.id === shard.id) return null;
					return renderShard(shard, false, dark, setHover, onNavigateForward);
				})}
				{/* Render the hovered shard last so its pulse animation paints on
				    top of neighboring strokes. */}
				{hover && renderShard(hover.shard, true, dark, setHover, onNavigateForward)}

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

			{hover && <Tooltip shard={hover.shard} x={hover.clientX} y={hover.clientY} />}
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
	isHovered: boolean,
	dark: boolean,
	setHover: React.Dispatch<React.SetStateAction<HoverState | null>>,
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
			className={isHovered ? "sunburst-shard-hover" : undefined}
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
			onClick={() => {
				if (shard.type === "directory") {
					onNavigateForward(...shard.path);
				}
			}}
		/>
	);
}

const Tooltip = ({
	shard,
	x,
	y,
}: {
	shard: ShardEntry;
	x: number;
	y: number;
}) => {
	const top = shard.file.type === "directory" ? shard.file.files.slice(0, 7) : [];
	return (
		<span
			className="pointer-events-none fixed z-10 select-none rounded-card bg-ink px-[14px] py-[10px] text-[12px] text-paper [box-shadow:var(--shadow-menu)]"
			style={{ left: x + 15, top: y + 5 }}
		>
			<span className="font-semibold">{shard.file.name}</span>
			<span className="ml-[14px] font-mono opacity-80">
				{readableSize(shard.file.size)}
			</span>
			{top.length > 0 && (
				<ol className="m-0 mt-[6px] list-none p-0">
					{top.map((file, i) => (
						<li
							key={`${file.name}-${i}`}
							className="m-0 flex justify-between gap-[14px] py-[2px] text-[11px]"
						>
							<span className="truncate">{file.name}</span>
							<span className="font-mono opacity-80">
								{readableSize(file.size)}
							</span>
						</li>
					))}
				</ol>
			)}
		</span>
	);
};

function buildShards(
	files: Ob.VfsNode[],
	capacity: number,
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
		nodes.forEach((file, idx) => {
			const sliceSize = file.size / capacity;
			const myHue = layer === 0 ? hueFor(idx) : (parentHue ?? hueFor(0));
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
		});
		return pos;
	};

	const totalEnd = walk(files, 0, 0, null, []);

	// Top-level imaginary remainder (small-items wedge at the inner ring).
	const totalUsed = files.reduce((sum, f) => sum + f.size, 0) / capacity;
	const remainder = totalUsed - totalEnd;
	if (remainder > minImaginary) {
		result.push({
			id: "imaginary/0",
			file: { type: "directory", name: "small items", size: 0, mtime: 0, files: [] },
			layer: 0,
			position: totalEnd,
			size: remainder,
			hue: hueFor(0),
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

function arcPath(
	position: number,
	size: number,
	ir: number,
	or: number,
): string {
	const a = (BASE_ANGLE_TURNS + position) * Math.PI * 2;
	const b = (BASE_ANGLE_TURNS + position + size) * Math.PI * 2;
	const largeArc = b - a > Math.PI ? 1 : 0;

	const ox1 = (or * Math.cos(a)).toFixed(2);
	const oy1 = (or * Math.sin(a)).toFixed(2);
	const ox2 = (or * Math.cos(b)).toFixed(2);
	const oy2 = (or * Math.sin(b)).toFixed(2);
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
