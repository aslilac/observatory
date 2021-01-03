import React, { Component, RefObject } from "react";

import { dispatch, navigateUp, navigateForward } from "../../../store/renderer";
import { readableSize } from "../../util";

const hsl = (h: number | string, s: number | string, l: number | string) => {
	return `hsl(${h}, ${s}%, ${l}%)`;
};

const getShardHsl = (
	hue: number,
	layer: number,
	min = 0,
	range = 1,
	type: Ob.NodeType$,
) => {
	const h = ((min + hue * range) * 360 - 5).toFixed(2);

	// TODO: Use in dark mode in the future
	// if (type === "directory") return hsl(h, 95, layer * 5 + 65);
	// if (type === "imaginary") return hsl(h, 0, 10);

	// return hsl(h, 0, layer * 5 + 35);

	if (type === "directory") return hsl(h, 95, layer * 5 + 65);
	if (type === "imaginary") return hsl(h, 0, 85);

	return hsl(h, 0, layer * 5 + 45);
};

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
};

type SunburstState = {
	animating: boolean;
	hoverTarget: AnimatedNode | null;
	tooltipOffsetX: number;
	tooltipOffsetY: number;
};

export class Sunburst extends Component<SunburstProps, SunburstState> {
	canvasRef: RefObject<HTMLCanvasElement>;

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
				<canvas id="fs-display-sunburst" ref={this.canvasRef}></canvas>
				{target && (
					<span
						id="fs-display-sunburst-float"
						style={{
							left: `${this.state.tooltipOffsetX + 15}px`,
							top: `${this.state.tooltipOffsetY + 5}px`,
						}}
					>
						{target.name}
						<span className="size">{readableSize(target.size)}</span>
						<br />

						{target.type === "directory" && target.files.length > 0 && (
							<ol>
								{target.files.slice(0, 7).map((file, index) => (
									<li key={`${file.name}-${index}`}>
										{file.name}
										<span className="size">
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
			dispatch(navigateUp());
			return;
		}

		// We only render like 7, so
		if (layer > 8) return;

		let position = 0;
		const scale = this.props.capacity;
		const search = (...searchPath: string[]) => (file: Ob.VfsNode) => {
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
							dispatch(navigateForward(...searchPath, file.name));
						}
					} else if (searchPath.length < layer && file.type === "directory") {
						// smaller items...
						if (layer <= 4 && layer === searchPath.length + 1) {
							const sizeOfContents = file.files.reduce(
								(sum, each) => sum + each.size,
								0,
							);
							if (position + sizeOfContents / scale <= t) {
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

			const draw = (layer: number) => (position: number, file: Ob.VfsNode) => {
				const size = file.size / scale;
				const state = hoverTarget?._original === file ? hoverTarget.state : null;
				this.drawShard(position, size, layer, state, file.type);

				if (file.type === "directory" && layer < 6) {
					if (file.files.length > 0) {
						const drawnEnd = file.files.reduce(draw(layer + 1), position);
						const remainderSize = file.size / scale - (drawnEnd - position);

						if (
							layer < 4 &&
							remainderSize > (this.props.rootSize / scale) * 0.003
						) {
							// smaller items...
							this.drawShard(
								drawnEnd,
								// Size of the directory minus the size of things drawn already
								remainderSize,
								layer + 1,
								null,
								"imaginary",
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

			// Draw the inner circle
			_2d.strokeStyle = "#e4e4e4";
			_2d.beginPath();
			_2d.lineWidth = 3;
			_2d.arc(cx, cy, 67, 0, 2 * Math.PI);
			_2d.stroke();

			const drawnEnd = this.props.files.reduce(draw(0), 0);

			// smaller items...
			this.drawShard(
				drawnEnd,
				this.props.size / scale - drawnEnd,
				0,
				null,
				"imaginary",
			);

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
	) {
		const _2d = this._2d!;
		const bounds = this.bounds!;
		const windowScale = this.windowScale!;

		const baseAngle = 5 / 8;
		const colorScale = this.props.capacity / this.props.size;
		const cx = bounds.width / windowScale / 2;
		const cy = bounds.height / windowScale / 2;

		const a = (baseAngle + position) * Math.PI * 2;
		const b = (baseAngle + position + size) * Math.PI * 2;

		// TODO: Might be nice to do some full circle special casing to look a bit tidier
		// if ((b - a) > Math.PI * 2) {
		// }

		const ir = layer > 4 ? 228 + 8 * (layer - 5) : 70 + 31 * layer;
		const or = layer > 4 ? 233 + 8 * (layer - 5) : 101 + 31 * layer;

		const outline = new Path2D();
		// Outer border clockwise
		outline.arc(cx, cy, or, a, b);
		// From outer border to inner border on far side
		outline.lineTo(cx + ir * Math.cos(b), cy + ir * Math.sin(b));
		// Inner border counter clockwise
		outline.arc(cx, cy, ir, b, a, true);
		// From inner border to outer border on starting side
		// outline.lineTo(cx + or * Math.cos(a), cy + or * Math.sin(a));
		outline.closePath();

		// Check state
		if (state?.hover) {
			state.hoverAnimation += 8 / 45;
			state.hoverAnimation %= 8;

			layer =
				state.hoverAnimation < 4
					? state.hoverAnimation
					: 8 - state.hoverAnimation;
		}

		// Set styles
		_2d.fillStyle = getShardHsl(
			(position + size / 2) * colorScale,
			layer,
			this.props.position,
			this.props.size / this.props.rootSize,
			type,
		);
		// TODO: Use in dark mode
		// _2d.strokeStyle = "#3d3350";
		_2d.strokeStyle = type === "imaginary" ? "#727D8F" : "#4B5566";
		_2d.lineWidth = 1 / window.devicePixelRatio;

		// Draw frame
		_2d.fill(outline);
		_2d.stroke(outline);
	}
}
