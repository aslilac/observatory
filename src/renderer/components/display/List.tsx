import React, { useState } from "react";

import { readableSize } from "../../util";

import backArrow from "url:../../assets/back.svg";

type ListProps = {
	cursor: string[];
	files: Ob.VfsNode[];
	name: string;
	size: number;
	canNavigateBack: boolean;
	onNavigateUp: () => void;
	onNavigateForward: (...into: string[]) => void;
};

export const List = (props: ListProps) => {
	const [expanded, setExpanded] = useState(
		props.files.length > 0 && props.files[0]!.size < props.size / 100,
	);

	return (
		<section
			id="fs-display-list"
			className="overflow-y-scroll break-words pl-0 [grid-area:list]"
		>
			{props.canNavigateBack && (
				<img
					// This is a patch for a bug in Parcel. It doesn't respect publicUrl
					// settings when using the url loader, so we remove any leading
					// slashes if present.
					src={backArrow.replace(/^\//, "")}
					className="absolute mt-[0.12in] mr-[0.1in] -mb-[0.05in] -ml-[0.15in] inline-block h-[0.3in] w-[0.3in] cursor-pointer rounded-full bg-accent px-[0.05in] py-[0.04in] transition-[opacity,margin] duration-300 hover:-ml-[0.175in]"
					onClick={props.onNavigateUp}
				/>
			)}
			<h1 className="ml-[0.35in] m-0 px-0 pt-[0.6rem] pb-[0.1rem] text-[1.5rem] font-light">
				{props.cursor.length
					? props.cursor[props.cursor.length - 1]
					: props.name}
				<span className="float-right pl-[0.2in]">
					{readableSize(props.size)}
				</span>
			</h1>
			<ol className="m-0 list-none p-[0.1in] pl-[0.35in]">
				{(expanded
					? props.files
					: props.files.filter((file) => file.size >= props.size / 100)
				).map((file, key) => (
					<li
						draggable
						key={key}
						className="-mb-[0.04in] cursor-default rounded p-[0.1in] transition-colors duration-300 hover:bg-accent hover:text-white"
						onClick={() => {
							if (file.type === "directory") props.onNavigateForward(file.name);
						}}
					>
						{file.name}
						<span className="float-right">{readableSize(file.size)}</span>
					</li>
				))}
				{expanded || (
					<li
						className="-mb-[0.04in] cursor-default rounded p-[0.1in] text-[0.9em] transition-colors duration-300 hover:bg-accent hover:text-white"
						onClick={() => setExpanded(true)}
					>
						show smaller items...
					</li>
				)}
			</ol>
		</section>
	);
};
