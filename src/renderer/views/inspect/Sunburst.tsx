import { useState } from "react";
import { sunburstColor } from "#/colors";
import { readableSize } from "#/util";
import { arcPath, isDrawable, layerRadii } from "./sunburstGeometry";

const VIEW_RADIUS = 275;
const CENTER_R = 64;
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

	const dark = document.documentElement.classList.contains("dark");

	return (
		<div className="grow">
			<svg
				viewBox={`${-VIEW_RADIUS} ${-VIEW_RADIUS} ${VIEW_RADIUS * 2} ${VIEW_RADIUS * 2}`}
				className="size-full"
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
		if (!isDrawable(sliceSize, layer)) {
			continue;
		}
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

		if (file.type === "directory" && layer < MAX_LAYER) {
			if (file.files.length > 0) {
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
			}

			// The rest of the directory goes in one gray wedge: children too
			// small to draw, whether they were dropped here or by the scanner
			// (rust-backend/tree.rs), which leaves no trace of them.
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
			strokeWidth={0.9}
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
			className="pointer-events-none fixed z-10 min-w-[180px] rounded-card bg-default px-4 py-3 text-[12px] text-background shadow-menu"
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
