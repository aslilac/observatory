import { MoonIcon, SunIcon } from "lucide-react";
import type { Theme } from "#/state";

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
		className="grid size-[22px] cursor-pointer place-items-center rounded-button text-muted hover:bg-fill hover:text-default"
	>
		{theme === "dark" ? <SunIcon size={13} /> : <MoonIcon size={13} />}
	</button>
);
