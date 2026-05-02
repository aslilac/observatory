import React, { Component, RefObject } from "react";

import { hueFor, sunburstColor } from "../colors";
import { readableSize } from "../util";

function readThemeColors(): {
	ink: string;
	paper: string;
	dark: boolean;
} {
	if (typeof document === "undefined") {
		return { ink: "#1a1a1a", paper: "#fafaf8", dark: false };
	}
	const styles = getComputedStyle(document.documentElement);
	const ink = styles.getPropertyValue("--color-ink").trim() || "#1a1a1a";
	const paper = styles.getPropertyValue("--color-paper").trim() || "#fafaf8";
	const dark = document.documentElement.classList.contains("dark");
	return { ink, paper, dark };
}

type AnimationState = {
	hover: boolean | "smallerItems";
	hoverAnimation: number;
};

type AnimatedNode = Ob.VfsNode & {
	state: AnimationState;
	_imaginary?: ImaginaryNode;
	_original: Ob.VfsNode;
};

type ImaginaryNode = {
	state: AnimationState;
	_parent: Ob.VfsNode;
};

type SunburstProps = {
	capacity: number;
	files: Ob.VfsNode[];
	size: number;
	position: number;
	rootSize: number;
	onNavigateUp: () => void;
	onNavigateForward: (...into: string[]) => void;
};

type SunburstState = {
	animating: boolean;
	hoverTarget: AnimatedNode | null;
	tooltipOffsetX: number;
	tooltipOffsetY: number;
};

export class Sunburst extends Component<SunburstProps, SunburstState> {
	canvasRef: RefObject<HTMLCanvasElement | null>;

	_2d?: CanvasRenderingContext2D;
	animationRequest: number | null;
	bounds?: DOMRect;
	pendingUpdateFrame: boolean;
	windowScale?: number;

	constructor(props: SunburstProps) {
		super(props);

		this.canvasRef = React.createRef<HTMLCanvasElement>();

		this.animationRequest = null;
		this.pendingUpdateFrame = false;

		this.state = {
			animating: false,
			hoverTarget: null,
			tooltipOffsetX: 0,
			tooltipOffsetY: 0,
		};
	}

	render() {
		const target = this.state.hoverTarget;

		return (
			<>
				<canvas
					id="fs-display-sunburst"
					ref={this.canvasRef}
					className="h-full w-full"
				></canvas>
				{target && (
					<span
						id="fs-display-sunburst-float"
						className="pointer-events-none fixed z-10 select-none rounded-card bg-ink px-[14px] py-[10px] text-paper text-[12px] transition-opacity duration-200 [box-shadow:var(--shadow-menu)]"
						style={{
							left: `${this.state.tooltipOffsetX + 15}px`,
							top: `${this.state.tooltipOffsetY + 5}px`,
						}}
					>
						<span className="font-semibold">{target.name}</span>
						<span className="ml-[14px] font-mono opacity-80">
							{readableSize(target.size)}
						</span>
						<br />

						{target.type === "directory" && target.files.length > 0 && (
							<ol className="m-0 mt-[6px] list-none p-0">
								{target.files.slice(0, 7).map((file, index) => (
									<li
										key={`${file.name}-${index}`}
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
				)}
			</>
		);
	}

	componentDidMount() {
		window.addEventListener("resize", () => {
			this.updateSizing();
		});

		window.addEventListener("focus", () => {
			this.animationRequest = requestAnimationFrame(() => this.animate());
		});

		window.addEventListener("blur", () => {
			this.resetHover();
			// Calling cancelAnimationFrame with null is fine actually
			cancelAnimationFrame(this.animationRequest!);
		});

		// Ref should be valid, since the component has mounted.
		// If we don't get a context, we're in trouble anyway.
		this._2d = this.canvasRef.current!.getContext("2d")!;

		this.updateSizing();
		this.animate();

		// SyntheticEvents suck, so we use a ref the get real Events.
		// Ref should be valid, since the component has mounted.
		const canvas = this.canvasRef.current!;
		canvas.addEventListener("click", this.handleMouseEvents);
		canvas.addEventListener("mousemove", this.handleMouseEvents);
		canvas.addEventListener("mouseleave", this.resetHover);

		window.addEventListener("keydown", (event) => {
			if (event.code === "KeyR") {
				console.log(":)");
				// this.pendingUpdateFrame = true;
				this.updateSizing();
			}
		});
	}

	componentDidUpdate() {
		this.updateSizing();
		this.pendingUpdateFrame = true;
	}

	handleMouseEvents = (event: MouseEvent) => {
		// These values are configured once the component has mounted.
		// If we're getting mouse events while the component isn't mounted,
		// we are in trouble.
		const bounds = this.bounds!;
		const windowScale = this.windowScale!;

		// Arbitrary angle value. Just looks nice to me.
		const baseAngle = 5 / 8;
		const cx = bounds.width / windowScale / 2;
		const cy = bounds.height / windowScale / 2;
		const ox = event.offsetX / windowScale;
		const oy = event.offsetY / windowScale;

		// Coordinate deltas from the center to the mouse
		const dx = ox - cx;
		const dy = oy - cy;

		// Angular distance from the center to the mouse
		const h = Math.hypot(dx, dy);
		// Radian angles repeat on the interval [0, Math.PI * 2], and the range
		// of acos is [0, Math.PI], and our angular coordinates are based on [0, 1].
		// We use acos because that range is always positive, which makes things
		// easy to map. We convert it from [0, Math.PI] to [0, 0.5], and then
		// use our dy coordinate to determine if it should be mapped to [0.5, 1],
		// which gives us our full circle.
		const c = Math.acos(dx / h) / (2 * Math.PI);
		const m = dy < 0 ? 1 - c : c;
		const t = (m < baseAngle ? 1 + m : m) - baseAngle;

		const layer = Math.max(
			Math.floor(h > 228 ? (h - 228) / 8 + 5 : (h - 70) / 31),
			-1,
		);

		if (layer === -1 && event.type === "click") {
			this.props.onNavigateUp();
			return;
		}

		// We only render like 7, so
		if (layer > 8) return;

		let position = 0;
		const scale = this.props.capacity;
		const search =
			(...searchPath: string[]) =>
			(file: Ob.VfsNode) => {
				const size = file.size / scale;
				if (position <= t) {
					if (position + size >= t) {
						if (layer === searchPath.length) {
							this.setState({
								tooltipOffsetX: event.clientX,
								tooltipOffsetY: event.clientY,
							});

							if (this.state.hoverTarget?._original !== file) {
								this.setHover(file);
							}

							if (event.type === "click" && file.type === "directory") {
								this.props.onNavigateForward(...searchPath, file.name);
							}
						} else if (searchPath.length < layer && file.type === "directory") {
							// smaller items...
							if (layer <= 4 && layer === searchPath.length + 1) {
								const sizeOfContents = file.files.reduce(
									(sum, each) => sum + each.size,
									0,
								);
								const remainderSize = sizeOfContents / scale;

								if (
									remainderSize > (this.props.capacity / scale) * 0.003 &&
									position + remainderSize <= t
								) {
									console.log("smaller items...");
								}
							}

							const found = file.files.some(search(...searchPath, file.name));
							if (!found) this.resetHover();
						} else {
							// No match
							this.resetHover();
						}
						// We return true to short circuit even if we didn't actually match,
						// because we know there won't be a valid match past this point.
						return true;
					}

					// The end of the current shard is less than theta, so check the next
					position += size;
					return false;
				} else {
					// No match
					// The begin position of the current shard is past theta, which
					// means there is no possible match. Stop the earch and reset
					// any hover state.
					this.resetHover();
					return true;
				}
			};

		const found = this.props.files.some(search());
		if (!found) this.resetHover();
	};

	private readonly setHover = (file: Ob.VfsNode, smallerItems = false) => {
		// Reset previous hoverTarget
		if (this.state.hoverTarget) {
			this.state.hoverTarget.state.hover = false;
		}

		this.setState({
			animating: true,
			hoverTarget: {
				...file,
				_original: file,
				state: {
					hover: !smallerItems,
					hoverAnimation: 1,
				},
			},
		});
	};

	private readonly resetHover = () => {
		if (this.state.hoverTarget) {
			this.state.hoverTarget.state.hover = false;

			this.setState({
				animating: false,
				hoverTarget: null,
			});
		}
	};

	private updateSizing() {
		const canvas = this.canvasRef.current;

		// This can get called after unmount...for reasons. So if this ref isn't current
		// then we can just exit early here.
		if (!canvas) {
			return;
		}

		let needsUpdate = false;
		const bounds = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio;
		const canvasHeight = Math.round(bounds.height * dpr);
		const canvasWidth = Math.round(bounds.width * dpr);

		this.bounds = bounds;

		if (canvasHeight !== canvas.height || canvasWidth !== canvas.width) {
			canvas.height = canvasHeight;
			canvas.width = canvasWidth;
			needsUpdate = true;
		}

		const windowScale = Math.min(bounds.height, bounds.width) / 575;

		if (windowScale !== this.windowScale) {
			this.windowScale = windowScale;
			this._2d!.scale(windowScale * dpr, windowScale * dpr);
			needsUpdate = true;
		}

		this.pendingUpdateFrame = needsUpdate;
	}

	private animate() {
		const { animating, hoverTarget } = this.state;

		if (animating || this.pendingUpdateFrame) {
			// We shouldn't ever be animating while the component is unmounted
			// and these are unconfigured.
			const _2d = this._2d!;
			const bounds = this.bounds!;
			const windowScale = this.windowScale!;
			const scale = this.props.capacity;

			const cx = bounds.width / windowScale / 2;
			const cy = bounds.height / windowScale / 2;

			const draw =
				(layer: number, parentHue: number | null) =>
				(position: number, file: Ob.VfsNode, idx: number) => {
					const size = file.size / scale;
					const state =
						hoverTarget?._original === file ? hoverTarget.state : null;
					// Top-level slices anchor a categorical hue from the same palette
					// as the legend list; descendants inherit the parent's hue so an
					// outer ring's color reads as related to its parent slice.
					const myHue = layer === 0 ? hueFor(idx) : (parentHue ?? hueFor(0));
					this.drawShard(position, size, layer, state, file.type, myHue);

					if (file.type === "directory" && layer < 6) {
						if (file.files.length > 0) {
							const drawnEnd = file.files.reduce(
								draw(layer + 1, myHue),
								position,
							);
							const remainderSize = file.size / scale - (drawnEnd - position);

							if (
								layer < 4 &&
								remainderSize > (this.props.capacity / scale) * 0.003
							) {
								// smaller items...
								this.drawShard(
									drawnEnd,
									remainderSize,
									layer + 1,
									null,
									"imaginary",
									myHue,
								);
							}
						}
					}

					return position + size;
				};

			_2d.clearRect(
				0,
				0,
				bounds.width * window.devicePixelRatio * windowScale,
				bounds.height * window.devicePixelRatio * windowScale,
			);

			const drawnEnd = this.props.files.reduce(draw(0, null), 0);

			// smaller items...
			this.drawShard(
				drawnEnd,
				this.props.size / scale - drawnEnd,
				0,
				null,
				"imaginary",
				hueFor(0),
			);

			// Ink center disc with total size — the design's defining moment.
			const { ink, paper } = readThemeColors();
			_2d.fillStyle = ink;
			_2d.beginPath();
			_2d.arc(cx, cy, 64, 0, 2 * Math.PI);
			_2d.fill();

			const total = readableSize(this.props.size);
			_2d.fillStyle = paper;
			_2d.font = "600 17px 'IBM Plex Mono', ui-monospace, monospace";
			_2d.textAlign = "center";
			_2d.textBaseline = "middle";
			_2d.fillText(total, cx, cy - 1);

			// We just redrew everything, so it should be up to date
			this.pendingUpdateFrame = false;
		}

		this.animationRequest = requestAnimationFrame(() => this.animate());
	}

	private drawShard(
		position: number,
		size: number,
		layer: number,
		state: AnimationState | null,
		type: Ob.NodeType$,
		hue: number,
	) {
		const _2d = this._2d!;
		const bounds = this.bounds!;
		const windowScale = this.windowScale!;

		const baseAngle = 5 / 8;
		const cx = bounds.width / windowScale / 2;
		const cy = bounds.height / windowScale / 2;

		const a = (baseAngle + position) * Math.PI * 2;
		const b = (baseAngle + position + size) * Math.PI * 2;

		const ir = layer > 4 ? 228 + 8 * (layer - 5) : 70 + 31 * layer;
		const or = layer > 4 ? 233 + 8 * (layer - 5) : 101 + 31 * layer;

		const outline = new Path2D();
		outline.arc(cx, cy, or, a, b);
		outline.lineTo(cx + ir * Math.cos(b), cy + ir * Math.sin(b));
		outline.arc(cx, cy, ir, b, a, true);
		outline.closePath();

		// Check state
		if (state?.hover) {
			state.hoverAnimation += 0.08;
			state.hoverAnimation %= 8;

			layer =
				state.hoverAnimation < 4
					? state.hoverAnimation
					: 8 - state.hoverAnimation;
		}

		const { paper, dark } = readThemeColors();

		_2d.fillStyle = sunburstColor(hue, layer, type, dark);
		_2d.strokeStyle = paper;
		_2d.lineWidth = 1.2;

		_2d.fill(outline);
		_2d.stroke(outline);
	}
}
