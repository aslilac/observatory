/*eslint-disable*/

import { ipcRenderer } from "electron";
import React, { Component, Fragment } from "react";

import readableSize from "./size";

import gardens from "../../gardens.config";
const garden = gardens.scope("renderer", "sunburst", "svg");

const DIRECTORY = 0;
const FILE = 1;
const SYMLINK = 2;
const DEVICE = 3;
const UNKNOWN = 4;

const Sunburst = (props) => (
	// let outline = new Path2D()
	// Outer border clockwise
	// outline.arc( cx, cy, or, a, b )
	// From outer border to inner border on far side
	// outline.lineTo( cx + ir * Math.cos( b ), cy + ir * Math.sin( b ) )
	// Inner border counter clockwise
	// outline.arc( cx, cy, ir, b, a, true )
	// From inner border to outer border on starting side
	// outline.lineTo( cx + or * Math.cos( a ), cy + or * Math.sin( a ) )
	// outline.closePath()

	<svg viewBox="0 0 100 100">
		<path
			d="M 50, 25
             A 25, 25 0,0,1 75, 50
             H 70
             A 20, 20 0,0,0 50, 30
             V 25 z"
			onclick="alert('yo')"
		/>
	</svg>
);

// // let titlebar = document.getElementById( 'titlebar' )

// class Sunburst extends Component {
//   constructor( props ) {
//     super( props )

//     // this.state = props.directory
//     this.canvasRef = React.createRef()
//     this.hoverRef = React.createRef()
//     this.pendingUpdate = false
//     this.animationRequest = null
//     this.hoverTarget = null
//   }

//   render() {
//     garden.log( this.props )
//     return <Fragment>
//       <canvas id="fs-display-sunburst" ref={this.canvasRef}></canvas>
//       <span id="fs-display-sunburst-float" ref={this.hoverRef}></span>
//     </Fragment>
//   }

//   componentDidMount() {
//     window.addEventListener( 'resize', () => this._size() )
//     window.addEventListener( 'focus', () => this.animationRequest = requestAnimationFrame( () => this.animate() ))
//     window.addEventListener( 'blur', () => {
//       this.resetHover()
//       cancelAnimationFrame( this.animationRequest )
//     })

//     this._size()
//     this.animate()

//     // SyntheticEvents suck.
//     let canvas = this.canvasRef.current
//     canvas.addEventListener( 'click', this.handleMouseEvents.bind( this ) )
//     canvas.addEventListener( 'mousemove', this.handleMouseEvents.bind( this ) )
//     // canvas.addEventListener( 'dragstart', this.handleMouseEvents.bind( this ) )
//     // canvas.addEventListener( 'dragend', this.handleMouseEvents.bind( this ) )
//   }

//   componentDidUpdate() {
//     this._size()
//   }

//   handleMouseEvents( event ) {
//     let baseAngle = 5/8
//     // let baseAngle = 0
//     let cx = this.bounds.width / this.windowScale / 2
//     let cy = this.bounds.height / this.windowScale / 2
//     // let cy = (this.bounds.height - 100) / this.windowScale / 2
//     let ox = event.offsetX / this.windowScale
//     let oy = event.offsetY / this.windowScale

//     let dx = ox - cx
//     let dy = oy - cy

//     let h = Math.hypot( dx, dy )
//     // We use acos because it's always positive and makes life easier.
//     // asin could also totally work, but adds some complexity that we can avoid this way.
//     let c = Math.acos( dx / h ) / (2*Math.PI)
//     let t = (dy < 0 ? 0.5 + 0.5 - c : c) - baseAngle

//     if ( t < 0 ) t += 1

//     let layer = Math.max(
//       Math.floor(
//         h > 228
//           ? ((h - 228) / 8) + 5
//           : (h - 70) / 31
//       ),
//       -1
//     )

//     if ( layer === -1 && event.type === 'click' ) {
//       ipcRenderer.send( 'vfs-navigateUp' )
//       return
//     }

//     let position = 0
//     let scale = this.props.capacity
//     let search = ( ...searchPath ) => file => {
//       let size = file.size / scale
//       if ( position <= t ) {
//         if ( position + size >= t ) {
//           if ( layer === searchPath.length ) {
//             let hover = this.hoverRef.current
//             hover.style.left = `${event.clientX + 15}px`
//             hover.style.top = `${event.clientY + 5}px`

//             if ( this.hoverTarget !== file ) this.setHover( file )

//             if ( event.type === 'click' && file.type === DIRECTORY ) {
//               ipcRenderer.send( 'vfs-navigateForward', ...searchPath, file.name )
//             }

//             // else if ( event.type === 'dragstart' ) {
//             //   garden.log( 'dragging', file )
//             //   titlebar.className = 'trash'
//             //   event.dataTransfer.setData( 'text/plain', Math.floor( Math.random() * 899999 + 100000 ) )
//             //   event.dataTransfer.effectAllowed = 'move'
//             //
//             //   let canvas = document.createElement( 'canvas' )
//             //   canvas.width = canvas.height = 50
//             //
//             //   let _2d = canvas.getContext( '2d' )
//             //   _2d.lineWidth = 20
//             //   _2d.strokeStyle = '#c5e6cf'
//             //   // Outer border clockwise
//             //   _2d.beginPath()
//             //   _2d.arc( 25, 25, 10, 0, 2*Math.PI )
//             //   _2d.stroke()
//             //
//             //   event.dataTransfer.setDragImage( canvas, 25, 25 )
//             // }
//             //
//             // else if ( event.type === 'dragend' ) {
//             //   titlebar.className = ''
//             // }
//           } else if ( searchPath.length < layer && file.type === DIRECTORY ) {
//             if ( !file.files ) throw garden.error( 'Directories have to have files!', file )
//             file.files.some( search( ...searchPath, file.name ) )
//           } else {
//             // No match
//             this.resetHover()
//           }
//           // We return true to short circuit if the range matched correctly,
//           // even if we didn't actually match.
//           return true
//         } else {
//           // No match
//           // We return true to short circuit if the range matched correctly,
//           // even if we didn't actually match.
//           this.resetHover()
//         }
//       }

//       position += size
//     }

//     this.props.files.some( search() )
//   }

//   setHover( file ) {
//     if ( this.hoverTarget ) this.hoverTarget.state.hover = false
//     this.hoverTarget = file
//     this.animating = true

//     file.state = {
//       hover: true,
//       hoverAnimation: 1
//     }

//     // XXX: This is bad and horrible and sad
//     this.hoverRef.current.style.opacity = 1
//     this.hoverRef.current.innerHTML = `${file.name}<span class="size">${readableSize(file.size)}</span>${
//       file.type === DIRECTORY && file.files.length ? `<br/><ol><li>${
//         file.files.slice( 0, 7 ).map( file => `${file.name}<span class="size">${readableSize(file.size)}</span>`).join( '</li><li>' )
//       }</li></ol>` : '' }`
//   }

//   resetHover() {
//     this.hoverRef.current.style.opacity = 0
//     if ( this.hoverTarget ) {
//       this.hoverTarget.state.hover = false
//       this.hoverTarget = null
//       // We don't need to animate every frame anymore, but we do want to run
//       // one last update to make sure the shard color has reset.
//       this.pendingUpdate = true
//       this.animating = false
//     }
//   }

//   _size() {
//     let canvas = this.canvasRef.current
//     this._2d = canvas.getContext( '2d' )

//     let dpr = window.devicePixelRatio || 1
//     let bounds = this.bounds = canvas.getBoundingClientRect()
//     canvas.height = bounds.height * dpr
//     canvas.width = bounds.width * dpr

//     let scale = this.windowScale = Math.min( bounds.height, bounds.width ) / 575
//     this._2d.scale( scale * dpr, scale * dpr )

//     this.pendingUpdate = true
//   }

//   _hsl( hue, layer, min = 0, range = 1 ) {
//     return `hsl(${((min+hue*range)*280).toFixed(2)}, 85%, ${layer*5 + 60}%)`
//   }

//   animate() {
//     if ( this.pendingUpdate || this.animating ) {
//       // garden.log( this.props )
//       let scale = this.props.capacity

//       let cx = this.bounds.width / this.windowScale / 2
//       let cy = this.bounds.height / this.windowScale / 2

//       let draw = layer => ( position, file ) => {
//         let size = file.size / scale
//         this.drawShard( position, size, layer, file.state )

//         if ( file.type === DIRECTORY && layer < 6 ) {
//           file.files.reduce( draw( layer + 1 ), position )
//         }

//         return position + size
//       }

//       this._2d.clearRect( 0, 0,
//         this.bounds.width * this.dpr * this.windowScale,
//         this.bounds.height * this.dpr * this.windowScale
//       )

//       this._2d.strokeStyle = '#e4e4e4'
//       this._2d.beginPath()
//       this._2d.lineWidth = 3
//       this._2d.arc( cx, cy, 67, 0, 2 * Math.PI )
//       this._2d.stroke()
//       this._2d.lineWidth = 1

//       this.props.files.reduce( draw( 0 ), 0 )
//       this.pendingUpdate = false
//     }

//     this.animationRequest = requestAnimationFrame( () => this.animate() )
//   }

//   drawShard( position, size, layer, state ) {
//     let baseAngle = 5/8
//     // let baseAngle = 0
//     let colorScale = this.props.capacity / this.props.size
//     let cx = this.bounds.width / this.windowScale / 2
//     let cy = this.bounds.height / this.windowScale / 2
//     // let cy = (this.bounds.height - 100) / this.windowScale / 2

//     let a = (baseAngle + position) * Math.PI * 2
//     let b = (baseAngle + position + size) * Math.PI * 2

//     let ir = layer > 4
//       ? 228 + 8 * (layer-5)
//       : 70 + 31 * layer
//     let or = layer > 4
//       ? 233 + 8 * (layer-5)
//       : 101 + 31 * layer

//     let outline = new Path2D()
//     // Outer border clockwise
//     outline.arc( cx, cy, or, a, b )
//     // From outer border to inner border on far side
//     outline.lineTo( cx + ir * Math.cos( b ), cy + ir * Math.sin( b ) )
//     // Inner border counter clockwise
//     outline.arc( cx, cy, ir, b, a, true )
//     // From inner border to outer border on starting side
//     outline.lineTo( cx + or * Math.cos( a ), cy + or * Math.sin( a ) )
//     outline.closePath()

//     // Check state
//     if ( state ) {
//       if ( state.hover ) {
//         state.hoverAnimation += 12/60
//         state.hoverAnimation %= 12

//         layer -= state.hoverAnimation < 6
//           ? state.hoverAnimation
//           : 12 - state.hoverAnimation
//       }
//     }

//     // Set styles
//     this._2d.fillStyle = this._hsl( (position + size/2)*colorScale, layer, this.props.position, this.props.size / this.props.rootSize )
//     this._2d.strokeStyle = '#3d3350'

//     // Draw frame
//     this._2d.fill( outline )
//     this._2d.stroke( outline )
//   }
// }

export default Sunburst;
