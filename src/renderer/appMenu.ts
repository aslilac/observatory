import { useEffect, useRef } from "react";

import { useNavigation } from "./navigation";
import { joinPath } from "./paths";
import { useCleanupQueue } from "./state";

type AppMenuProps = {
	scan: Ob.ScanInfo | null;
	theme: "light" | "dark";
	onToggleTheme: () => void;
	onRescan: (path: string) => void;
};

// The application menu's side of the window (src/main/menu.ts): tells main
// where the window is, for what's enabled and checked, and does what's
// picked about what's on screen.
export function useAppMenu({
	scan,
	theme,
	onToggleTheme,
	onRescan,
}: AppMenuProps): void {
	const { cursor, canBack, canForward, showMenu } = useNavigation();
	const { panelOpen, setPanelOpen } = useCleanupQueue();

	const complete = scan?.status === "complete";
	// The dev fake disk isn't anywhere to show.
	const onDisk = complete && !scan.path.startsWith("fake://");
	const state: Ob.MenuState = {
		canBack,
		canForward,
		scan: scan && scan.status !== "building" ? scan.path : null,
		folder: onDisk ? joinPath(scan.path, ...cursor) : null,
		canFind: complete,
		cleanupOpen: panelOpen,
		theme,
	};
	const key = JSON.stringify(state);
	useEffect(() => {
		void Ob.publishMenuState(JSON.parse(key) as Ob.MenuState);
	}, [key]);

	// The latest of everything, so the subscription doesn't churn.
	const latest = useRef({ state, panelOpen, setPanelOpen, onToggleTheme });
	latest.current = { state, panelOpen, setPanelOpen, onToggleTheme };
	const rescan = useRef(onRescan);
	rescan.current = onRescan;
	const home = useRef(showMenu);
	home.current = showMenu;

	useEffect(
		() =>
			Ob.onMenuCommand((command) => {
				const now = latest.current;
				switch (command) {
					case "rescan":
						if (now.state.scan) {
							rescan.current(now.state.scan);
						}
						break;
					case "reveal":
						if (now.state.folder) {
							void Ob.revealInFinder(now.state.folder);
						}
						break;
					case "find":
						document.querySelector<HTMLInputElement>("[data-find]")?.focus();
						break;
					case "toggle-cleanup":
						now.setPanelOpen(!now.panelOpen);
						break;
					case "toggle-theme":
						now.onToggleTheme();
						break;
					case "home":
						home.current();
						break;
				}
			}),
		[],
	);
}
