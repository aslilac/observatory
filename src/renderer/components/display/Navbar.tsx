import { chic } from 'react-chic';

import {
	dispatch,
	navigateTo,
	navigateToRoot,
	showDriveList,
} from "../../../store/renderer";

interface NavbarProps {
	cursor: string[];
	name: string;
}

export const Navbar = (props: NavbarProps) => {
	const { cursor, name } = props;

	return (
		<chic.section cx="fs-display-navbar">
			<button onClick={() => dispatch(showDriveList())}>Disks and folders</button>
			<button onClick={() => dispatch(navigateToRoot())}>{name}</button>
			{cursor.map((piece, i) => (
				<button
					key={i}
					onClick={() => dispatch(navigateTo(cursor.slice(0, i + 1)))}
				>
					{piece}
				</button>
			))}
		</chic.section>
	);
};
