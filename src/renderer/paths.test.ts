import { beforeEach, describe, expect, it } from "vitest";

import { basename, joinPath } from "./paths.js";

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
});
