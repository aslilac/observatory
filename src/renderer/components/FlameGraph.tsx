import { useMemo, useState } from "react";

type FlameGraphProps = {
	tree: Ob.PerfNode;
};

// Per-row height. Tight enough that ~10 levels fit in a single screen
// without scrolling, but readable at the 10px monospace label size.
const ROW_HEIGHT = 18;

// Below this width we don't recurse into a subtree — at that scale the
// children would be sub-pixel slivers anyway.
const MIN_VISIBLE_WIDTH_PCT = 0.3;

// Below this width we skip the label text. The bar still renders as a
// hoverable hit target, just unlabeled.
const MIN_LABEL_WIDTH_PCT = 4;

type LaidOut = {
	node: Ob.PerfNode;
	x: number;
	width: number;
	depth: number;
};

function findNode(root: Ob.PerfNode, path: string): Ob.PerfNode | null {
	if (root.path === path) {
		return root;
	}
	for (const c of root.children) {
		const found = findNode(c, path);
		if (found) {
			return found;
		}
	}
	return null;
}

// Walks from `root` down to the node at `path`, returning the chain. If
// path isn't reachable (e.g. it was filtered out of the latest snapshot),
// returns just the root so the breadcrumb stays sensible.
function pathTo(root: Ob.PerfNode, path: string): Ob.PerfNode[] {
	const chain: Ob.PerfNode[] = [];
	const walk = (node: Ob.PerfNode): boolean => {
		chain.push(node);
		if (node.path === path) {
			return true;
		}
		for (const c of node.children) {
			if (walk(c)) {
				return true;
			}
		}
		chain.pop();
		return false;
	};
	walk(root);
	return chain.length > 0 ? chain : [root];
}

// Lay out children proportional to their elapsed time within the parent's
// width. Sum-of-siblings = parent width, regardless of whether the parent
// ran in parallel — so the X axis is a "share of parent's wall time"
// rather than an absolute scale. Tooltips carry the absolute numbers.
function layout(root: Ob.PerfNode): LaidOut[] {
	const items: LaidOut[] = [];
	const baseDepth = root.depth;
	const visit = (node: Ob.PerfNode, x: number, width: number) => {
		items.push({ node, x, width, depth: node.depth - baseDepth });
		if (width < MIN_VISIBLE_WIDTH_PCT) {
			return;
		}
		if (node.children.length === 0) {
			return;
		}
		let total = 0;
		for (const c of node.children) {
			total += Math.max(c.elapsedMs, 0);
		}
		if (total === 0) {
			return;
		}
		let childX = x;
		for (const child of node.children) {
			const t = Math.max(child.elapsedMs, 0);
			const childWidth = (t / total) * width;
			visit(child, childX, childWidth);
			childX += childWidth;
		}
	};
	visit(root, 0, 100);
	return items;
}

export const FlameGraph: React.FC<FlameGraphProps> = ({ tree }) => {
	const [zoomPath, setZoomPath] = useState<string | null>(null);

	const focused = useMemo(() => {
		if (!zoomPath) {
			return tree;
		}
		return findNode(tree, zoomPath) ?? tree;
	}, [tree, zoomPath]);

	const items = useMemo(() => layout(focused), [focused]);
	const maxDepth = items.reduce((m, i) => Math.max(m, i.depth), 0);

	const crumbs = useMemo(
		() => (zoomPath ? pathTo(tree, zoomPath) : [tree]),
		[tree, zoomPath],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-[6px]">
			<div className="flex items-center gap-[6px] overflow-x-auto font-mono text-[10px] whitespace-nowrap text-muted">
				{crumbs.map((node, i) => (
					<span key={node.path} className="flex items-center gap-[6px]">
						{i > 0 && <span className="text-faint">›</span>}
						<button
							type="button"
							onClick={() => setZoomPath(i === 0 ? null : node.path)}
							className="cursor-pointer text-default hover:underline"
						>
							{i === 0 ? node.path : node.name || "/"}
						</button>
					</span>
				))}
				<span className="ml-auto pl-[12px] text-faint">
					{focused.totalMs > 0
						? `${focused.totalMs.toFixed(0)}ms total · ${focused.selfMs.toFixed(0)}ms self`
						: `${focused.elapsedMs.toFixed(0)}ms elapsed (in progress)`}
				</span>
			</div>
			<div
				className="relative w-full overflow-hidden rounded border border-line bg-fill"
				style={{ height: (maxDepth + 1) * ROW_HEIGHT + 2 }}
			>
				{items.map(({ node, x, width, depth }) => (
					<FlameNode
						key={node.path}
						node={node}
						x={x}
						width={width}
						depth={depth}
						onClick={() => setZoomPath(node.path)}
					/>
				))}
			</div>
		</div>
	);
};

type FlameNodeProps = {
	node: Ob.PerfNode;
	x: number;
	width: number;
	depth: number;
	onClick: () => void;
};

const FlameNode: React.FC<FlameNodeProps> = ({
	node,
	x,
	width,
	depth,
	onClick,
}) => {
	// Heat = self-time as a fraction of total time. A pure-work leaf gets
	// heat=1; a thin pass-through to one heavy child gets heat≈0. Maps to
	// a 15%..60% mix with the foreground color so hot spots pop.
	const heat = node.totalMs > 0 ? Math.min(1, node.selfMs / node.totalMs) : 0;
	const mixPct = Math.round((0.15 + 0.45 * heat) * 100);
	const bg = `color-mix(in srgb, var(--color-default) ${mixPct}%, transparent)`;
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			title={`${node.path}
self ${node.selfMs.toFixed(0)}ms / total ${node.totalMs.toFixed(0)}ms · readdir ${node.readdirMs.toFixed(0)}ms · ${node.entryCount.toLocaleString()} entries · depth ${node.depth}${node.inProgress ? "\n(in progress)" : ""}`}
			className={`absolute cursor-pointer overflow-hidden rounded-[2px] border px-[4px] text-left font-mono text-[10px] leading-[16px] text-default hover:border-default ${node.inProgress ? "border-dashed border-default/50" : "border-line-soft"}`}
			style={{
				left: `${x}%`,
				width: `${width}%`,
				top: depth * ROW_HEIGHT + 1,
				height: ROW_HEIGHT - 2,
				backgroundColor: bg,
			}}
		>
			{width > MIN_LABEL_WIDTH_PCT && (
				<span className="block truncate">{node.name || "/"}</span>
			)}
		</button>
	);
};
