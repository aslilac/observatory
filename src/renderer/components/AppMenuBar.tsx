import { useEffect, useRef, useState } from "react";

import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

// Windows and Linux: the window has no menu bar (see src/main/viewManager.ts),
// so the title bar draws the application menu, as VS Code does. Main builds
// it (src/main/menu.ts) and runs what's picked; this only draws it. It's
// drawn here rather than popped up natively so that, with one menu open,
// hovering another switches to it, as in any menu bar. Shortcuts work
// either way, through the native menu.
export const AppMenuBar: React.FC = () => {
	const [menus, setMenus] = useState<Ob.AppMenu>([]);
	useEffect(() => Ob.onAppMenu(setMenus), []);
	// Which menu is open. Base UI closes a menu opened by hovering as soon as
	// the pointer leaves its label, and then there's no open menu for the
	// next one to take over from; in a menu bar, it stays open until another
	// opens or you click away.
	const [open, setOpenState] = useState<string | null>(null);
	// the same, for the closing menu to see before React has rendered
	const openNow = useRef<string | null>(null);
	const setOpen = (label: string | null) => {
		openNow.current = label;
		setOpenState(label);
	};

	// Where focus was before the menu bar took it. It goes back there when
	// the menus close, as if they'd never had it, and before a picked item
	// runs: Edit → Copy copies from whatever has focus.
	const returnTo = useRef<HTMLElement | null>(null);
	const finalFocus = () => {
		// Switching to another menu: that one has focus now.
		if (openNow.current !== null) {
			return false;
		}
		const was = returnTo.current;
		return was?.isConnected ? was : true;
	};
	// once the menu has closed, and focus is back
	const run = (id: string) =>
		requestAnimationFrame(() => void Ob.clickAppMenuItem(id));

	return (
		<Menubar
			className="flex h-full items-center pl-[6px] [-webkit-app-region:no-drag]"
			onPointerDownCapture={(e) => {
				if (openNow.current !== null) {
					return;
				}
				const active = document.activeElement;
				returnTo.current =
					active instanceof HTMLElement &&
					active !== document.body &&
					!e.currentTarget.contains(active)
						? active
						: null;
			}}
		>
			{menus.map((menu) => (
				<Menu.Root
					key={menu.label}
					open={open === menu.label}
					onOpenChange={(next, { reason }) => {
						if (next) {
							setOpen(menu.label);
						} else if (
							reason !== "trigger-hover" &&
							openNow.current === menu.label
						) {
							setOpen(null);
						}
					}}
				>
					<Menu.Trigger
						disabled={!menu.enabled}
						className="h-[26px] cursor-default rounded-button px-[8px] font-normal text-muted outline-none hover:bg-fill hover:text-default focus-visible:bg-fill data-[popup-open]:bg-fill data-[popup-open]:text-default"
					>
						{menu.label}
					</Menu.Trigger>
					<Popup
						items={menu.items}
						onPick={run}
						finalFocus={finalFocus}
						align="start"
						sideOffset={2}
					/>
				</Menu.Root>
			))}
		</Menubar>
	);
};

type PopupProps = {
	items: Ob.AppMenuItem[];
	onPick: (id: string) => void;
	finalFocus?: () => HTMLElement | boolean;
	align?: "start";
	sideOffset?: number;
};

const Popup: React.FC<PopupProps> = ({
	items,
	onPick,
	finalFocus,
	align,
	sideOffset,
}) => (
	<Menu.Portal>
		<Menu.Positioner
			className="z-50 outline-none"
			align={align}
			sideOffset={sideOffset}
		>
			<Menu.Popup
				finalFocus={finalFocus}
				className="min-w-[220px] rounded-card border border-line-soft bg-background py-1 text-[13px] [box-shadow:var(--shadow-menu)] outline-none"
			>
				<Items items={items} onPick={onPick} />
			</Menu.Popup>
		</Menu.Positioner>
	</Menu.Portal>
);

const ROW =
	"flex w-full cursor-default items-center gap-[10px] py-1.5 pr-3 pl-[30px] text-left text-default outline-none select-none data-[disabled]:text-faint data-[highlighted]:bg-fill data-[disabled]:data-[highlighted]:bg-transparent";

const Items: React.FC<{
	items: Ob.AppMenuItem[];
	onPick: (id: string) => void;
}> = ({ items, onPick }) =>
	items.map((item, i) => {
		if (item.kind === "separator") {
			return <Menu.Separator key={i} className="my-1 h-px bg-line-soft" />;
		}
		if (item.kind === "submenu") {
			return (
				<Menu.SubmenuRoot key={i}>
					<Menu.SubmenuTrigger
						disabled={!item.enabled}
						className={`${ROW} data-[popup-open]:bg-fill`}
					>
						<span className="flex-1">{item.label}</span>
						<ChevronRightIcon size={13} className="text-muted" />
					</Menu.SubmenuTrigger>
					<Popup items={item.items} onPick={onPick} />
				</Menu.SubmenuRoot>
			);
		}
		return (
			<Menu.Item
				key={i}
				disabled={!item.enabled}
				onClick={() => onPick(item.id)}
				title={item.sublabel}
				className={`relative ${ROW}`}
			>
				{item.checked && (
					<CheckIcon size={13} className="absolute left-[10px]" />
				)}
				<span className="flex-1 truncate">{item.label}</span>
				{item.accelerator && (
					<span className="text-[12px] text-faint">{item.accelerator}</span>
				)}
			</Menu.Item>
		);
	});
