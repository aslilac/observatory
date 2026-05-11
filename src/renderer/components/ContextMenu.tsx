import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";

export type ContextMenuItem =
	| {
			kind: "item";
			label: string;
			disabled?: boolean;
			onClick: () => void;
	  }
	| { kind: "separator" };

type RowMenuProps = {
	items: ContextMenuItem[];
	className?: string;
	onClick?: (e: React.MouseEvent) => void;
	title?: string;
	children: React.ReactNode;
};

// Wraps a row element with a right-click context menu. The row itself becomes
// the trigger, so the outer className/handlers stay on the same DOM node as
// before — no extra wrapper.
export const RowMenu: React.FC<RowMenuProps> = ({
	items,
	className,
	onClick,
	title,
	children,
}) => (
	<BaseContextMenu.Root>
		<BaseContextMenu.Trigger
			className={className}
			onClick={onClick}
			title={title}
		>
			{children}
		</BaseContextMenu.Trigger>
		<MenuPopup items={items} />
	</BaseContextMenu.Root>
);

const MenuPopup: React.FC<{ items: ContextMenuItem[] }> = ({ items }) => (
	<BaseContextMenu.Portal>
		<BaseContextMenu.Positioner className="z-50 outline-none">
			<BaseContextMenu.Popup className="min-w-[180px] rounded-card border border-line-soft bg-background py-1 text-[13px] outline-none [box-shadow:var(--shadow-menu)]">
				{items.map((item, i) =>
					item.kind === "separator" ? (
						<BaseContextMenu.Separator
							key={`sep-${i}`}
							className="my-1 h-px bg-line-soft"
						/>
					) : (
						<BaseContextMenu.Item
							key={item.label}
							disabled={item.disabled}
							onClick={item.onClick}
							className="block w-full cursor-pointer px-3 py-1.5 text-left text-default outline-none select-none data-[highlighted]:bg-fill data-[disabled]:cursor-default data-[disabled]:text-faint data-[disabled]:data-[highlighted]:bg-transparent"
						>
							{item.label}
						</BaseContextMenu.Item>
					),
				)}
			</BaseContextMenu.Popup>
		</BaseContextMenu.Positioner>
	</BaseContextMenu.Portal>
);
