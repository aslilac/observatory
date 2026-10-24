import { beforeAll, describe, expect, it } from "vitest";

import { describeDrive, readableSize, roundedSize } from "./format.js";

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

describe("roundedSize", () => {
	it("rounds to what's on the box", () => {
		expect(roundedSize(1.5 * 1024 ** 4)).toBe("1.5 TB");
		expect(roundedSize(1.995 * 1024 ** 4)).toBe("2 TB");
		expect(roundedSize(476.9 * 1024 ** 3)).toBe("477 GB");
	});

	it("steps up instead of rounding to 1000", () => {
		expect(roundedSize(999.7 * 1024 ** 3)).toBe("1 TB");
	});
});

describe("describeDrive", () => {
	const drive: Ob.PhysicalDrive = {
		mountPath: "/",
		description: "Macintosh HD",
		network: false,
		startup: false,
		external: false,
		encrypted: false,
	};
	const terabytes = (n: number) => ({
		total: n * 1024 ** 4,
		used: 0,
		available: 0,
	});

	it("says what kind of disk it is, and how big", () => {
		expect(
			describeDrive({
				...drive,
				startup: true,
				encrypted: true,
				usage: terabytes(2),
			}),
		).toBe("2 TB encrypted startup disk");
		expect(
			describeDrive({ ...drive, external: true, usage: terabytes(4) }),
		).toBe("4 TB external disk");
		expect(describeDrive({ ...drive, external: true })).toBe("External disk");
	});

	it("names the machine a share is from", () => {
		const share = { ...drive, network: true };
		expect(describeDrive({ ...share, server: "Pecha", protocol: "SMB" })).toBe(
			"Pecha – SMB network share",
		);
		expect(describeDrive({ ...share, protocol: "NFS" })).toBe(
			"NFS network share",
		);
		expect(describeDrive(share)).toBe("Network share");
	});
});
