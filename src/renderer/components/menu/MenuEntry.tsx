import { useSelector } from "react-redux";

import { AppState, createVfs, dispatch, inspectVfs } from "../../../store/renderer";

interface MenuEntryProps {
	name: string;
	path: string;
}

export const MenuEntry = (props: MenuEntryProps) => {
	const { name, path } = props;

	const vfsInstance = useSelector((state: AppState) => state.vfs.get(path));

	return (
		<li>
			{name} - {vfsInstance?.status ?? "not scanned"}
			{vfsInstance ? (
				<button
					onClick={() => dispatch(inspectVfs(path))}
					disabled={vfsInstance.status !== "complete"}
				>
					View
				</button>
			) : (
				<button onClick={() => dispatch(createVfs(path))}>Scan</button>
			)}
		</li>
	);
};
