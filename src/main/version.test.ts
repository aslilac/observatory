import { describe, expect, it } from "vitest";
import { isNewer } from "./version";

describe("isNewer", () => {
	it("compares releases numerically", () => {
		expect(isNewer("1.10.0", "1.9.0")).toBe(true);
		expect(isNewer("1.9.0", "1.10.0")).toBe(false);
		expect(isNewer("2.0.0", "1.99.99")).toBe(true);
		expect(isNewer("1.2.3", "1.2.3")).toBe(false);
	});

	it("reads release tags", () => {
		expect(isNewer("v1.0.1", "1.0.0")).toBe(true);
		expect(isNewer("v1.0.0", "1.0.0")).toBe(false);
	});

	it("puts a prerelease before its release", () => {
		expect(isNewer("1.0.0", "1.0.0-beta.1")).toBe(true);
		expect(isNewer("1.0.0-beta.1", "1.0.0")).toBe(false);
		expect(isNewer("1.0.1-beta.1", "1.0.0")).toBe(true);
	});

	it("compares prereleases as semver does", () => {
		expect(isNewer("1.0.0-beta.2", "1.0.0-beta.1")).toBe(true);
		expect(isNewer("1.0.0-beta.10", "1.0.0-beta.9")).toBe(true);
		expect(isNewer("1.0.0-beta", "1.0.0-alpha.1")).toBe(true);
		expect(isNewer("1.0.0-alpha.beta", "1.0.0-alpha.1")).toBe(true);
		expect(isNewer("1.0.0-alpha.1", "1.0.0-alpha")).toBe(true);
	});

	it("ignores build metadata", () => {
		expect(isNewer("1.0.0+2", "1.0.0+1")).toBe(false);
	});

	it("never takes something that isn't a version for a newer one", () => {
		expect(isNewer("nightly", "1.0.0")).toBe(false);
		expect(isNewer("1.0.1", "nightly")).toBe(false);
	});
});
