import React, { Component, RefObject } from "react";
import ReactDOM from "react-dom";

import { navigateUp, store, navigateForward } from "../../../store/renderer";
import { DIRECTORY, NodeType, VfsNode } from "../../../types";
import readableSize from "../../size";

const { dispatch } = store;

const hsl = (hue: number, layer: number, min = 0, range = 1, type: NodeType) =>
	`hsl(${((min + hue * range) * 280).toFixed(2)}, ${
		type === DIRECTORY ? "85%" : "0%"
	}, ${layer * 5 + 60}%)`;

type AnimationState = {
	hover: boolean;
	hoverAnimation: number;
};

type AnimatedNode = VfsNode & {
	state?: AnimationState;
	_original?: AnimatedNode;
};

type SunburstProps = {
	capacity: number;
	files: VfsNode[];
	size: number;
	position: number;
	rootSize: number;
};

export class Sunburst extends Component<SunburstProps> {
	canvasRef: RefObject<HTMLCanvasElement>;
	tooltipRef: RefObject<HTMLSpanElement>;

	_2d: CanvasRenderingContext2D;
	animating: boolean;
	animationRequest: number;
	bounds: DOMRect;
	dpr: number;
	hoverTarget: AnimatedNode;
	pendingUpdate: boolean;
	windowScale: number;

	constructor(props: SunburstProps) {
		super(props);

		this.canvasRef = React.createRef<HTMLCanvasElement>();
		this.tooltipRef = React.createRef<HTMLSpanElement>();

		this.pendingUpdate = false;
		this.animationRequest = null;
		this.hoverTarget = null;
		this.animating = false;
	}

	render() {
		return (
			<>
				<canvas id="fs-display-sunburst" ref={this.canvasRef}></canvas>
				<span id="fs-display-sunburst-float" ref={this.tooltipRef}></span>
			</>
		);
	}

	componentDidMount() {
		window.addEventListener("resize", () => this._size());
		window.addEventListener("focus", () => {
			this.animationRequest = requestAnimationFrame(() => this.animate());
		});
		window.addEventListener("blur", () => {
			this.resetHover();
			cancelAnimationFrame(this.animationRequest);
		});

		this._size();
		this.animate();

		// SyntheticEvents suck, so we use a ref the get real Events.
		const canvas = this.canvasRef.current;
		canvas.addEventListener("click", this.handleMouseEvents.bind(this));
		canvas.addEventListener("mousemove", this.handleMouseEvents.bind(this));
	}

	componentDidUpdate() {
		this._size();
	}

	handleMouseEvents(event: MouseEvent) {
		const dpr = window.devicePixelRatio;

		const baseAngle = 5 / 8;
		const cx = this.bounds.width / this.windowScale / 2;
		const cy = this.bounds.height / this.windowScale / 2;
		// let cy = (this.bounds.height - 100) / this.windowScale / 2
		const ox = event.offsetX / this.windowScale;
		const oy = event.offsetY / this.windowScale;

		const dx = ox - cx;
		const dy = oy - cy;

		const h = Math.hypot(dx, dy);
		// We use acos because it's always positive and makes life easier.
		// asin could also totally work, but adds some complexity that we can avoid this way.
		const c = Math.acos(dx / h) / (2 * Math.PI);
		let t = (dy < 0 ? 0.5 + 0.5 - c : c) - baseAngle;

		if (t < 0) t += 1;

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
		const search = (...searchPath: string[]) => (file: AnimatedNode) => {
			const size = file.size / scale;
			if (position <= t) {
				if (position + size >= t) {
					console.log(layer, searchPath.length, file.type);
					if (layer === searchPath.length) {
						const hover = this.tooltipRef.current;
						hover.style.left = `${event.clientX + 15}px`;
						hover.style.top = `${event.clientY + 5}px`;

						if (this.hoverTarget?._original !== file) this.setHover(file);

						if (event.type === "click" && file.type === DIRECTORY) {
							dispatch(navigateForward(...searchPath, file.name));
						}
					} else if (searchPath.length < layer && file.type === DIRECTORY) {
						const found = file.files.some(search(...searchPath, file.name));
						if (!found) this.resetHover();
					} else {
						// No match
						this.resetHover();
					}
					// We return true to short circuit if the range matched correctly,
					// even if we didn't actually match.
					return true;
				}
			} else {
				// No match
				// The begin position of the current shard is past theta, which
				// means there is no possible match. Stop the earch and reset
				// any hover state.
				this.resetHover();
				return true;
			}

			position += size;
		};

		const found = this.props.files.some(search());
		if (!found) this.resetHover();
	}

	setHover(file: AnimatedNode) {
		if (this.hoverTarget) this.hoverTarget.state.hover = false;
		const target = (this.hoverTarget = { ...file, _original: file });
		this.animating = true;

		target.state = {
			hover: true,
			hoverAnimation: 1,
		};

		// Doing sub renders isn't great, but it works.
		// If we ever switch to SVG for rendering the graph we could probably
		// do this a much better way.
		ReactDOM.render(
			<>
				{target.name}
				<span className="size">{readableSize(target.size)}</span>
				<br />

				{target.type === DIRECTORY && target.files.length > 0 && (
					<ol>
						{target.files.slice(0, 7).map((file, index) => (
							<li key={file.name + index}>
								{file.name}
								<span className="size">{readableSize(file.size)}</span>
							</li>
						))}
					</ol>
				)}
			</>,
			this.tooltipRef.current,
			() => {
				this.tooltipRef.current.style.opacity = "1";
			},
		);
	}

	resetHover() {
		this.tooltipRef.current.style.opacity = "0";
		if (this.hoverTarget) {
			this.hoverTarget.state.hover = false;
			this.hoverTarget = null;
			// We don't need to animate every frame anymore, but we do want to run
			// one last update to make sure the shard color has reset.
			this.pendingUpdate = true;
			this.animating = false;
		}
	}

	_size() {
		const canvas = this.canvasRef.current;
		this._2d = canvas.getContext("2d");

		const dpr = window.devicePixelRatio || 1;
		const bounds = (this.bounds = canvas.getBoundingClientRect());
		canvas.height = bounds.height * dpr;
		canvas.width = bounds.width * dpr;

		const scale = (this.windowScale = Math.min(bounds.height, bounds.width) / 575);
		this._2d.scale(scale * dpr, scale * dpr);

		this.pendingUpdate = true;
	}

	animate() {
		if (this.pendingUpdate || this.animating) {
			const scale = this.props.capacity;

			const cx = this.bounds.width / this.windowScale / 2;
			const cy = this.bounds.height / this.windowScale / 2;

			const draw = (layer: number) => (position: number, file: AnimatedNode) => {
				const size = file.size / scale;
				const state =
					this.hoverTarget?._original === file ? this.hoverTarget.state : null;
				this.drawShard(position, size, layer, state, file.type);

				if (file.type === DIRECTORY && layer < 6) {
					file.files.reduce(draw(layer + 1), position);
				}

				return position + size;
			};

			this._2d.clearRect(
				0,
				0,
				this.bounds.width * this.dpr * this.windowScale,
				this.bounds.height * this.dpr * this.windowScale,
			);

			this._2d.strokeStyle = "#e4e4e4";
			this._2d.beginPath();
			this._2d.lineWidth = 3;
			this._2d.arc(cx, cy, 67, 0, 2 * Math.PI);
			this._2d.stroke();
			this._2d.lineWidth = 1;

			this.props.files.reduce(draw(0), 0);
			this.pendingUpdate = false;
		}

		this.animationRequest = requestAnimationFrame(() => this.animate());
	}

	drawShard(
		position: number,
		size: number,
		layer: number,
		state: AnimationState,
		type: NodeType,
	) {
		const baseAngle = 5 / 8;
		// let baseAngle = 0
		const colorScale = this.props.capacity / this.props.size;
		const cx = this.bounds.width / this.windowScale / 2;
		const cy = this.bounds.height / this.windowScale / 2;
		// let cy = (this.bounds.height - 100) / this.windowScale / 2

		const a = (baseAngle + position) * Math.PI * 2;
		const b = (baseAngle + position + size) * Math.PI * 2;

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
		outline.lineTo(cx + or * Math.cos(a), cy + or * Math.sin(a));
		outline.closePath();

		// Check state
		if (state?.hover) {
			state.hoverAnimation += 12 / 60;
			state.hoverAnimation %= 12;

			layer -=
				state.hoverAnimation < 6
					? state.hoverAnimation
					: 12 - state.hoverAnimation;
		}

		// Set styles
		this._2d.fillStyle = hsl(
			(position + size / 2) * colorScale,
			layer,
			this.props.position,
			this.props.size / this.props.rootSize,
			type,
		);
		this._2d.strokeStyle = "#3d3350";

		// Draw frame
		this._2d.fill(outline);
		this._2d.stroke(outline);
	}
}
