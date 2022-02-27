import React, { useState } from "react";
import { chic } from "react-chic";
import { useSelector } from "react-redux";

import { AppState, dispatch, navigateForward, navigateUp } from "../../../store/renderer";
import { readableSize } from "../../util";

import backArrow from "url:../../assets/back.svg";

type ListProps = {
	cursor: string[];
	files: Ob.VfsNode[];
	name: string;
	size: number;
};

export const List = (props: ListProps) => {
	const [expanded, setExpanded] = useState(
		props.files.length > 0 && props.files[0]!.size < props.size / 100,
	);

	const canNavigateBack = useSelector(
		(state: AppState) => state.vfs.get(state.inspecting!)!.cursor!.length > 0,
	);

	return (
		<chic.section cx="fs-display-list">
			{canNavigateBack && (
				<chic.img
					// This is a patch for a bug in Parcel. It doesn't respect publicUrl settings
					// when using the url loader, so we remove any leading slashes if present.
					src={backArrow.replace(/^\//, "")}
					cx="back"
					// onClick={() => history.back()}
					onClick={() => dispatch(navigateUp())}
				/>
			)}
			<h1>
				{props.cursor.length ? props.cursor[props.cursor.length - 1] : props.name}
				<chic.span cx="size">{readableSize(props.size)}</chic.span>
			</h1>
			<ol>
				{(expanded
					? props.files
					: props.files.filter((file) => file.size >= props.size / 100)
				).map((file, key) => (
					<li
						draggable
						key={key}
						onClick={() => {
							if (file.type === "directory")
								dispatch(navigateForward(file.name));
						}}
					>
						{file.name}
						<chic.span cx="size">{readableSize(file.size)}</chic.span>
					</li>
				))}
				{expanded || (
					<li className="expand" onClick={() => setExpanded(true)}>
						show smaller items...
					</li>
				)}
			</ol>
		</chic.section>
	);
};
