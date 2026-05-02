import { beforeAll, describe, expect, it } from "vitest";

import { readableSize } from "./util.js";

describe("readableSize", () => {
	beforeAll(() => {
		// `Ob.platform` is normally injected by the preload contextBridge; in
		// node-side tests we stub it so the SI-vs-IEC branch is deterministic.
		(globalThis as { Ob?: { platform: string } }).Ob = { platform: "linux" };
	});

	it("formats bytes with the right suffix", () => {
		expect(readableSize(0)).toBe("0 bytes");
		expect(readableSize(512)).toBe("512 bytes");
	});

	it("steps to KB at 1024 on linux", () => {
		expect(readableSize(1024)).toBe("1 KB");
	});
});
