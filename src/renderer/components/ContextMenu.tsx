import { useEffect, useRef, useState } from "react";

export type ContextMenuItem =
	| {
			kind: "item";
			label: string;
			accelerator?: string;
			disabled?: boolean;
			onClick: () => void;
	  }
	| { kind: "separator" };

type State = {
	x: number;
	y: number;
	items: ContextMenuItem[];
};

type ContextMenuHandle = {
	open: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
	render: React.ReactNode;
};

// Light right-click menu matching the design's typography. Anchors at the
// click position, flips left/up if it would overflow the viewport, closes on
// outside click / scroll / Escape / window blur. Built on a hook so each
// surface can manage its own items without prop-drilling.
export function useContextMenu(): ContextMenuHandle {
	const [state, setState] = useState<State | null>(null);
	const ref = useRef<HTMLDivElement | null>(null);

	const open = (e: React.MouseEvent, items: ContextMenuItem[]) => {
		e.preventDefault();
		e.stopPropagation();
		setState({ x: e.clientX, y: e.clientY, items });
	};

	const close = () => setState(null);

	useEffect(() => {
		if (!state) return;
		const onPointerDown = (event: PointerEvent) => {
			if (
				ref.current &&
				event.target instanceof Node &&
				ref.current.contains(event.target)
			) {
				return;
			}
			close();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", close, true);
		window.addEventListener("blur", close);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("blur", close);
		};
	}, [state]);

	// After mounting, nudge the menu inside the viewport if it overflows.
	useEffect(() => {
		if (!state || !ref.current) return;
		const el = ref.current;
		const rect = el.getBoundingClientRect();
		const overflowX = rect.right - window.innerWidth;
		const overflowY = rect.bottom - window.innerHeight;
		if (overflowX > 0) {
			el.style.left = `${Math.max(8, state.x - rect.width)}px`;
		}
		if (overflowY > 0) {
			el.style.top = `${Math.max(8, state.y - rect.height)}px`;
		}
	}, [state]);

	const render = state ? (
		<div
			ref={ref}
			className="fixed z-50 min-w-[180px] rounded-card border border-line-soft bg-background py-1 text-[13px] [box-shadow:var(--shadow-menu)]"
			style={{ left: state.x, top: state.y }}
		>
			{state.items.map((item, i) =>
				item.kind === "separator" ? (
					<div
						key={`sep-${i}`}
						className="my-1 h-px bg-line-soft"
						role="separator"
					/>
				) : (
					<button
						key={item.label}
						type="button"
						disabled={item.disabled}
						onClick={() => {
							close();
							item.onClick();
						}}
						className="flex w-full cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-left text-default hover:bg-fill disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
					>
						<span>{item.label}</span>
						{item.accelerator && (
							<span className="font-mono text-[11px] text-faint">
								{item.accelerator}
							</span>
						)}
					</button>
				),
			)}
		</div>
	) : null;

	return { open, render };
}
