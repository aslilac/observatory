import type { Theme } from "../state";

type ThemeToggleProps = {
	theme: Theme;
	onToggle: () => void;
};

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
	theme,
	onToggle,
}) => (
	<button
		type="button"
		onClick={onToggle}
		title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
		className="grid size-[22px] cursor-pointer place-items-center rounded-button text-muted hover:bg-fill hover:text-ink darwin:[-webkit-app-region:no-drag]"
	>
		{theme === "dark" ? <SunIcon /> : <MoonIcon />}
	</button>
);

const MoonIcon: React.FC = () => (
	<svg
		width="13"
		height="13"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
	</svg>
);

const SunIcon: React.FC = () => (
	<svg
		width="13"
		height="13"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<circle cx="12" cy="12" r="4" />
		<path d="M12 2v2" />
		<path d="M12 20v2" />
		<path d="M4.93 4.93l1.41 1.41" />
		<path d="M17.66 17.66l1.41 1.41" />
		<path d="M2 12h2" />
		<path d="M20 12h2" />
		<path d="M4.93 19.07l1.41-1.41" />
		<path d="M17.66 6.34l1.41-1.41" />
	</svg>
);
