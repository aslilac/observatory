import React, { useCallback, useEffect } from "react";

import { List } from "./List";
import { Sunburst } from "./Sunburst";

type DisplayProps = {
	tree: Ob.RenderTree;
	cursor: string[];
	setCursor: (cursor: string[]) => void;
	onShowMenu: () => void;
};

export const Display = ({
	tree,
	cursor,
	setCursor,
	onShowMenu,
}: DisplayProps) => {
	useEffect(() => {
		void Ob.sizeToDisplay();
	}, []);

	const navigateUp = useCallback(
		() => setCursor(cursor.slice(0, -1)),
		[cursor, setCursor],
	);
	const navigateForward = useCallback(
		(...into: string[]) => setCursor([...cursor, ...into]),
		[cursor, setCursor],
	);
	const navigateToRoot = useCallback(() => setCursor([]), [setCursor]);
	const navigateTo = useCallback(
		(next: string[]) => setCursor(next),
		[setCursor],
	);

	const { sunburst, list, ...shared } = tree;

	// This makes sure that the state kept by List is maintained relative to the
	// directory that the state is for. We don't use this for Sunburst, because
	// that would cause React to destroy/create our canvas element on every
	// navigation.
	const stateKey = shared.cursor.join("/");

	return (
		<>
			<section
				id="fs-display-navbar"
				className="relative px-[0.2in] py-[0.1in] [grid-area:navbar]"
			>
				<button className="btn" onClick={onShowMenu}>
					Disks and folders
				</button>
				<button className="btn" onClick={navigateToRoot}>
					{shared.name}
				</button>
				{shared.cursor.map((piece, i) => (
					<button
						key={i}
						className="btn"
						onClick={() => navigateTo(shared.cursor.slice(0, i + 1))}
					>
						{piece}
					</button>
				))}
			</section>
			<Sunburst
				files={sunburst.files}
				onNavigateUp={navigateUp}
				onNavigateForward={navigateForward}
				{...shared}
			/>
			<List
				key={stateKey}
				files={list.files}
				canNavigateBack={cursor.length > 0}
				onNavigateUp={navigateUp}
				onNavigateForward={navigateForward}
				{...shared}
			/>
		</>
	);
};
