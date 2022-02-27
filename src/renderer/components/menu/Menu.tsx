import React, { useEffect } from "react";
import { chic, Stylist } from "react-chic";
import { useSelector } from "react-redux";

import { AppState } from "../../../store/renderer";
import { MenuEntry } from "./MenuEntry";

import styles from "./Menu.module.scss";

export const Menu = () => {
	const drives = useSelector((state: AppState) => state.drives);
	const vfsMap = useSelector((state: AppState) => state.vfs);

	useEffect(() => {
		Ob.sizeToMenu();
	}, [drives, vfsMap]);

	return (
		<Stylist styles={styles}>
			<section>
				<chic.ul cx="menu-drivelist">
					{Array.from(drives.values()).map((drive) => (
						<MenuEntry
							key={drive.mountPath}
							name={drive.description}
							path={drive.mountPath}
						/>
					))}
					{Array.from(vfsMap.keys())
						.filter((path) => !drives.has(path))
						.map((path) => (
							<MenuEntry key={path} name={path} path={path} />
						))}
				</chic.ul>
				<button onClick={Ob.selectDirectory}>Scan directory</button>
			</section>
		</Stylist>
	);
};
