import { ipcRenderer } from "electron";
import React, { useState } from "react";

import readableSize from "./size";

import gardens from "../../gardens.config";
const garden = gardens.scope("renderer", "list");

const DIRECTORY = 0;
// const FILE = 1;
// const SYMLINK = 2;
// const DEVICE = 3;
// const UNKNOWN = 4;

const Back = () => (
	<div className="back" onClick={() => history.back()}>
		<svg viewBox="0 0 412 412">
			<g>
				<g>
					<path
						style={{ fill: "#090509" }}
						d="M387,181.25c14,0,25,11,25,25s-11,24-25,24H84l91,92c10,10,10,24,0,34c-5,5-11,7-17,7s-13-2-18-7
					l-133-133c-5-5-7-11-7-17c0-7,2-12,7-17l133-133c10-10,25-10,35,0s10,24,0,34l-91,91H387z"
					/>
				</g>
			</g>
		</svg>
	</div>
);

export default function List(props) {
	const [expanded, setExpanded] = useState(false);

	garden.log(props);

	// function onDragStart() {
	//   titlebar.className = 'trash'
	//   let id = event.target.id = Math.floor( Math.random() * 899999 + 100000 )
	//   event.dataTransfer.setData( 'filePointer', id )
	//   event.dataTransfer.effectAllowed = 'move'
	// }

	// function onDragEnd() {
	//   titlebar.className = ''
	// }

	return (
		<section id="fs-display-list">
			{/* <img
				src={backArrow}
				className="back"
				onClick={() => history.back()}
			/> */}
			<Back />
			<h1>
				{props.cursor.length
					? props.cursor[props.cursor.length - 1]
					: props.name}
				<span className="size">{readableSize(props.size)}</span>
			</h1>
			<ol>
				{(expanded
					? props.files
					: props.files.filter(file => file.size >= props.size / 100)
				).map((file, key) => (
					<li
						draggable
						key={key}
						onClick={() => {
							if (file.type === DIRECTORY)
								ipcRenderer.send(
									"vfs-navigateForward",
									file.name,
								);
						}}
					>
						{file.name}
						<span className="size">{readableSize(file.size)}</span>
					</li>
				))}
				{expanded || (
					<li className="expand" onClick={() => setExpanded(true)}>
						show smaller items...
					</li>
				)}
			</ol>
		</section>
	);
}
