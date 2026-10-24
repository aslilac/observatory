import { beforeEach, describe, expect, it } from "vitest";

import { basename, isWithin, joinPath } from "./paths.js";

// `Ob.platform` is normally injected by the preload contextBridge.
function on(platform: string) {
	beforeEach(() => {
		(globalThis as { Ob?: { platform: string } }).Ob = { platform };
	});
}

describe("on macOS and Linux", () => {
	on("linux");

	it("joins names with /", () => {
		expect(joinPath("/", "Users", "kayla")).toBe("/Users/kayla");
		expect(joinPath("/Users/", "kayla", "", "a.iso")).toBe(
			"/Users/kayla/a.iso",
		);
		expect(joinPath("/Users")).toBe("/Users");
		expect(joinPath("fake://disk", "a")).toBe("fake://disk/a");
	});

	it("names the last segment", () => {
		expect(basename("/Users/kayla/")).toBe("kayla");
		expect(basename("/")).toBe("/");
		expect(basename("/Users/kayla/a\\b")).toBe("a\\b");
	});

	describe("isWithin", () => {
		const queued = new Set(["/Users/kayla/Downloads", "/Users/kayla/a.iso"]);

		it("matches the paths themselves and what's inside them", () => {
			expect(isWithin("/Users/kayla/a.iso", queued)).toBe(true);
			expect(isWithin("/Users/kayla/Downloads", queued)).toBe(true);
			expect(isWithin("/Users/kayla/Downloads/x/y.zip", queued)).toBe(true);
		});

		it("doesn't match folders around them, or names they start", () => {
			expect(isWithin("/Users/kayla", queued)).toBe(false);
			expect(isWithin("/Users/kayla/Downloads old", queued)).toBe(false);
			expect(isWithin("/Users/kayla/a.iso.part", queued)).toBe(false);
			expect(isWithin("/Users/kayla/a.iso\\x", queued)).toBe(false);
		});
	});
});

describe("on Windows", () => {
	on("win32");

	it("joins names with \\", () => {
		expect(joinPath("C:\\", "Users", "kayla")).toBe("C:\\Users\\kayla");
		expect(joinPath("C:\\Users", "kayla")).toBe("C:\\Users\\kayla");
		expect(joinPath("\\\\pecha\\isos", "a.iso")).toBe("\\\\pecha\\isos\\a.iso");
	});

	it("names the last segment, after either slash", () => {
		expect(basename("C:\\Users\\kayla\\")).toBe("kayla");
		expect(basename("C:/Users/kayla")).toBe("kayla");
		expect(basename("C:\\")).toBe("C:");
	});

	it("goes up through either slash in isWithin", () => {
		const queued = new Set(["C:\\Temp"]);
		expect(isWithin("C:\\Temp\\x.log", queued)).toBe(true);
		expect(isWithin(joinPath("C:\\", "Temp", "x", "y.log"), queued)).toBe(true);
		expect(isWithin("C:\\Temporary", queued)).toBe(false);
	});
});
