import { describe, expect, it } from "vitest";

import { groupReserved } from "./reserved";

describe("groupReserved", () => {
	it("adds up each kind, in a fixed order", () => {
		const groups = groupReserved([
			{ kind: "restore", name: "System Volume Information", size: 50 },
			{ kind: "paging", name: "swapfile.sys", size: 10 },
			{ kind: "paging", name: "pagefile.sys", size: 300 },
		]);
		expect(groups.map((g) => [g.label, g.size, g.names])).toEqual([
			["virtual memory", 310, ["swapfile.sys", "pagefile.sys"]],
			["system restore", 50, ["System Volume Information"]],
		]);
	});

	it("has nothing to show for nothing", () => {
		expect(groupReserved([])).toEqual([]);
	});
});
