import { ipcRenderer } from "electron";
import React, { Component } from "react";
import ReactDOM from "react-dom";

import readableSize from "./size";

import gardens from "../../gardens.config";
const garden = gardens.scope("renderer", "sunburst");

const DIRECTORY = 0;
// const FILE = 1;
// const SYMLINK = 2;
// const DEVICE = 3;
// const UNKNOWN = 4;

// let titlebar = document.getElementById( 'titlebar' )

function hsl(hue, layer, min = 0, range = 1) {
	return `hsl(${((min + hue * range) * 280).toFixed(2)}, 85%, ${layer * 5 +
		60}%)`;
}

class Sunburst extends Component {
	constructor(props) {
		super(props);

		// this.state = props.directory
		this.canvasRef = React.createRef();
		this.hoverRef = React.createRef();
		this.pendingUpdate = false;
		this.animationRequest = null;
		this.hoverTarget = null;
	}

	render() {
		garden.log(this.props);
		return (
			<>
				<canvas id="fs-display-sunburst" ref={this.canvasRef}></canvas>
				<span id="fs-display-sunburst-float" ref={this.hoverRef}></span>
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
		// canvas.addEventListener( 'dragstart', this.handleMouseEvents.bind( this ) )
		// canvas.addEventListener( 'dragend', this.handleMouseEvents.bind( this ) )
	}

	componentDidUpdate() {
		this._size();
	}

	handleMouseEvents(event) {
		const baseAngle = 5 / 8;
		// let baseAngle = 0
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
			ipcRenderer.send("vfs-navigateUp");
			return;
		}

		let position = 0;
		const scale = this.props.capacity;
		const search = (...searchPath) => file => {
			const size = file.size / scale;
			if (position <= t) {
				if (position + size >= t) {
					if (layer === searchPath.length) {
						const hover = this.hoverRef.current;
						hover.style.left = `${event.clientX + 15}px`;
						hover.style.top = `${event.clientY + 5}px`;

						if (this.hoverTarget !== file) this.setHover(file);

						if (event.type === "click" && file.type === DIRECTORY) {
							ipcRenderer.send(
								"vfs-navigateForward",
								...searchPath,
								file.name,
							);
						}

						// else if ( event.type === 'dragstart' ) {
						//   garden.log( 'dragging', file )
						//   titlebar.className = 'trash'
						//   event.dataTransfer.setData(
						//     'text/plain', Math.floor( Math.random() * 899999 + 100000 )
						//   )
						//   event.dataTransfer.effectAllowed = 'move'
						//
						//   let canvas = document.createElement( 'canvas' )
						//   canvas.width = canvas.height = 50
						//
						//   let _2d = canvas.getContext( '2d' )
						//   _2d.lineWidth = 20
						//   _2d.strokeStyle = '#c5e6cf'
						//   // Outer border clockwise
						//   _2d.beginPath()
						//   _2d.arc( 25, 25, 10, 0, 2*Math.PI )
						//   _2d.stroke()
						//
						//   event.dataTransfer.setDragImage( canvas, 25, 25 )
						// }
						//
						// else if ( event.type === 'dragend' ) {
						//   titlebar.className = ''
						// }
					} else if (
						searchPath.length < layer &&
						file.type === DIRECTORY
					) {
						if (!file.files)
							throw garden.error(
								"Directories have to have files!",
								file,
							);
						file.files.some(search(...searchPath, file.name));
					} else {
						// No match
						this.resetHover();
					}
					// We return true to short circuit if the range matched correctly,
					// even if we didn't actually match.
					return true;
				} else {
					// No match
					// We return true to short circuit if the range matched correctly,
					// even if we didn't actually match.
					this.resetHover();
				}
			}

			position += size;
		};

		this.props.files.some(search());
	}

	setHover(file) {
		if (this.hoverTarget) this.hoverTarget.state.hover = false;
		this.hoverTarget = file;
		this.animating = true;

		file.state = {
			hover: true,
			hoverAnimation: 1,
		};

		// Doing sub renders isn't great, but it works.
		// If we ever switch to SVG for rendering the graph we could probably
		// do this a much better way.
		ReactDOM.render(
			<>
				{file.name}
				<span className="size">{readableSize(file.size)}</span>
				<br />

				{file.type === DIRECTORY && file.files.length > 0 && (
					<ol>
						{file.files.slice(0, 7).map((file, index) => (
							<li key={file.name + index}>
								{file.name}
								<span className="size">
									{readableSize(file.size)}
								</span>
							</li>
						))}
					</ol>
				)}
			</>,
			this.hoverRef.current,
			() => {
				this.hoverRef.current.style.opacity = 1;
			},
		);
	}

	resetHover() {
		this.hoverRef.current.style.opacity = 0;
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

		const scale = (this.windowScale =
			Math.min(bounds.height, bounds.width) / 575);
		this._2d.scale(scale * dpr, scale * dpr);

		this.pendingUpdate = true;
	}

	animate() {
		if (this.pendingUpdate || this.animating) {
			// garden.log( this.props )
			const scale = this.props.capacity;

			const cx = this.bounds.width / this.windowScale / 2;
			const cy = this.bounds.height / this.windowScale / 2;

			const draw = layer => (position, file) => {
				const size = file.size / scale;
				this.drawShard(position, size, layer, file.state);

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

	drawShard(position, size, layer, state) {
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
		if (state) {
			if (state.hover) {
				state.hoverAnimation += 12 / 60;
				state.hoverAnimation %= 12;

				layer -=
					state.hoverAnimation < 6
						? state.hoverAnimation
						: 12 - state.hoverAnimation;
			}
		}

		// Set styles
		this._2d.fillStyle = hsl(
			(position + size / 2) * colorScale,
			layer,
			this.props.position,
			this.props.size / this.props.rootSize,
		);
		this._2d.strokeStyle = "#3d3350";

		// Draw frame
		this._2d.fill(outline);
		this._2d.stroke(outline);
	}
}

export default Sunburst;
