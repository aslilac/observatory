// Space Windows keeps for itself at the root of a disk (Ob.ReservedSpace),
// grouped by what it's for, the way the legend and the sunburst show it.
export type ReservedGroup = {
	kind: Ob.ReservedSpace["kind"];
	label: string;
	// What it is, and whether there's anything to do about it.
	hint: string;
	names: string[];
	size: number;
};

const KINDS: Record<Ob.ReservedSpace["kind"], { label: string; hint: string }> =
	{
		paging: {
			label: "virtual memory",
			hint: "Where Windows moves memory it's short of. Windows sizes it itself.",
		},
		hibernation: {
			label: "hibernation",
			hint: "Where Windows saves memory to hibernate, and for fast startup.",
		},
		restore: {
			label: "system restore",
			hint: "Restore points and other shadow copies. System Protection sets how much they may use.",
		},
	};

const ORDER: Ob.ReservedSpace["kind"][] = ["paging", "hibernation", "restore"];

export function groupReserved(reserved: Ob.ReservedSpace[]): ReservedGroup[] {
	return ORDER.flatMap((kind) => {
		const of = reserved.filter((r) => r.kind === kind);
		if (of.length === 0) {
			return [];
		}
		return [
			{
				kind,
				...KINDS[kind],
				names: of.map((r) => r.name),
				size: of.reduce((sum, r) => sum + r.size, 0),
			},
		];
	});
}
