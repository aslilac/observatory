import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

import { perfMark } from "./perf";

type NavView = "scan" | "cleanup";
type NavEntry = {
	view: NavView;
	inspecting: string | null;
	cursor: string[];
};

type NavState = {
	history: NavEntry[];
	index: number;
};

const sameCursor = (a: string[], b: string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

const sameEntry = (a: NavEntry, b: NavEntry) =>
	a.view === b.view &&
	a.inspecting === b.inspecting &&
	sameCursor(a.cursor, b.cursor);

type NavigationContextValue = {
	view: NavView;
	inspecting: string | null;
	cursor: string[];
	canBack: boolean;
	canForward: boolean;
	goBack: () => void;
	goForward: () => void;
	setInspecting: (path: string | null) => void;
	setCursor: (next: string[]) => void;
	showCleanup: () => void;
	showMenu: () => void;
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

type NavigationProviderProps = {
	children: React.ReactNode;
};

export const NavigationProvider: React.FC<NavigationProviderProps> = ({
	children,
}) => {
	const [nav, setNav] = useState<NavState>(() => ({
		history: [
			{
				view: "scan",
				// Set when main opened the window straight into a scan (see
				// createWindow in src/main/viewManager.ts).
				inspecting: new URLSearchParams(location.search).get("inspect"),
				cursor: [],
			},
		],
		index: 0,
	}));
	const current = nav.history[nav.index]!;
	const { view, inspecting, cursor } = current;

	const navigate = useCallback((entry: NavEntry) => {
		perfMark("nav:start");
		setNav((prev) => {
			const truncated = prev.history.slice(0, prev.index + 1);
			const last = truncated[truncated.length - 1]!;
			if (sameEntry(last, entry)) {
				return prev;
			}
			return {
				history: [...truncated, entry],
				index: truncated.length,
			};
		});
	}, []);

	const goBack = useCallback(() => {
		setNav((prev) =>
			prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev,
		);
	}, []);

	const goForward = useCallback(() => {
		setNav((prev) =>
			prev.index < prev.history.length - 1
				? { ...prev, index: prev.index + 1 }
				: prev,
		);
	}, []);

	const setInspecting = useCallback(
		(path: string | null) =>
			navigate({ view: "scan", inspecting: path, cursor: [] }),
		[navigate],
	);

	const setCursor = useCallback(
		(next: string[]) => navigate({ view: "scan", inspecting, cursor: next }),
		[navigate, inspecting],
	);

	const showCleanup = useCallback(
		() => navigate({ view: "cleanup", inspecting, cursor }),
		[navigate, inspecting, cursor],
	);

	const showMenu = useCallback(() => setInspecting(null), [setInspecting]);

	// Main process can ask the renderer to land on a specific scan (e.g.
	// after a directory pick) or to walk the history (e.g. via menu). Both
	// subscriptions live here so the provider owns every entry point that
	// mutates the nav stack.
	useEffect(() => Ob.onSetInspecting(setInspecting), [setInspecting]);
	useEffect(
		() =>
			Ob.onNav((direction) => {
				if (direction === "back") {
					goBack();
				} else {
					goForward();
				}
			}),
		[goBack, goForward],
	);

	const value: NavigationContextValue = {
		view,
		inspecting,
		cursor,
		canBack: nav.index > 0,
		canForward: nav.index < nav.history.length - 1,
		goBack,
		goForward,
		setInspecting,
		setCursor,
		showCleanup,
		showMenu,
	};

	return (
		<NavigationContext.Provider value={value}>
			{children}
		</NavigationContext.Provider>
	);
};

export const useNavigation = (): NavigationContextValue => {
	const ctx = useContext(NavigationContext);
	if (!ctx) {
		throw new Error("useNavigation must be used inside a NavigationProvider");
	}
	return ctx;
};
