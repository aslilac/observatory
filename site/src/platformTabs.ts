// The downloads page's platforms: a tab for each, and the one that's picked open
// across the page below them, with its files and how to install them.
//
//   [data-os-tabs]               the tabs
//     <a class="os-tab" href="#macos" id="tab-macos">
//   <article class="os" id="macos">   its panel
//
// Without this, the tabs are links to the panels, and every panel is shown. The
// picked one is in the URL's hash, so a link to ./download/#windows opens Windows.

export type Desktop = "macos" | "windows" | "linux";

export interface PlatformTabs {
	select(os: Desktop): void;
	markYours(os: Desktop): void;
	picked: Desktop | undefined; // from the hash, if it named one
}

export function platformTabs(fallback: Desktop): PlatformTabs | undefined {
	const list = document.querySelector<HTMLElement>("[data-os-tabs]");
	if (!list) return undefined;
	const tabs = [...list.querySelectorAll<HTMLAnchorElement>("a.os-tab")];
	const panelOf = (tab: HTMLAnchorElement) =>
		document.getElementById(tab.hash.slice(1));
	const tabOf = (os: string) => tabs.find((t) => t.hash === `#${os}`);

	list.setAttribute("role", "tablist");
	for (const tab of tabs) {
		const panel = panelOf(tab);
		tab.setAttribute("role", "tab");
		if (panel) {
			tab.setAttribute("aria-controls", panel.id);
			panel.setAttribute("role", "tabpanel");
			panel.setAttribute("aria-labelledby", tab.id);
		}
	}
	document.documentElement.classList.add("os-tabbed");

	function select(os: string): boolean {
		const picked = tabOf(os);
		if (!picked) return false;
		for (const tab of tabs) {
			const on = tab === picked;
			tab.setAttribute("aria-selected", String(on));
			tab.tabIndex = on ? 0 : -1;
			panelOf(tab)?.classList.toggle("open", on);
		}
		return true;
	}

	for (const tab of tabs) {
		tab.addEventListener("click", (event) => {
			event.preventDefault();
			const os = tab.hash.slice(1);
			select(os);
			// remembered in the URL, without jumping to the panel
			history.replaceState(null, "", `#${os}`);
		});
	}

	// arrow keys move between the tabs, as in any tab list
	list.addEventListener("keydown", (event) => {
		const at = tabs.findIndex((t) => t === document.activeElement);
		if (at < 0) return;
		const to =
			event.key === "ArrowRight"
				? (at + 1) % tabs.length
				: event.key === "ArrowLeft"
					? (at - 1 + tabs.length) % tabs.length
					: event.key === "Home"
						? 0
						: event.key === "End"
							? tabs.length - 1
							: -1;
		if (to < 0) return;
		event.preventDefault();
		tabs[to]?.click();
		tabs[to]?.focus();
	});

	// a link on the page to one of them (or back and forward between them)
	window.addEventListener("hashchange", () => {
		if (select(location.hash.slice(1))) {
			list.scrollIntoView({ block: "start" });
		}
	});

	const fromHash = location.hash.slice(1);
	const picked = tabOf(fromHash) ? (fromHash as Desktop) : undefined;
	select(picked ?? fallback);
	// the panel was hidden when the browser went to it, so go to the tabs
	if (picked) list.scrollIntoView({ block: "start" });

	return {
		select,
		markYours: (os) => tabOf(os)?.classList.add("yours"),
		picked,
	};
}
