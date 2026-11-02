import { describe, expect, test } from "vitest";
import { describeRef, parseKeyFile, parseOsRelease } from "./keyFiles";

describe("parseOsRelease", () => {
	test("reads quoted and bare values", () => {
		const fields = parseOsRelease(
			[
				"# a comment",
				'NAME="Fedora Linux"',
				"VERSION_ID=43",
				"PRETTY_NAME='Fedora Linux 43 (Workstation Edition)'",
				'HOME_URL="https://fedoraproject.org/"',
				'QUOTED="say \\"hi\\""',
				"",
			].join("\n"),
		);
		expect(fields.get("NAME")).toBe("Fedora Linux");
		expect(fields.get("VERSION_ID")).toBe("43");
		expect(fields.get("PRETTY_NAME")).toBe(
			"Fedora Linux 43 (Workstation Edition)",
		);
		expect(fields.get("QUOTED")).toBe('say "hi"');
	});
});

describe("parseKeyFile", () => {
	test("keys each value by its group", () => {
		const fields = parseKeyFile(
			[
				"[Application]",
				"name=ooo.lilac.observatory",
				"runtime=runtime/org.freedesktop.Platform/x86_64/26.08",
				"",
				"[Instance]",
				"flatpak-version=1.17.0",
				"runtime-extensions=org.freedesktop.Platform.GL.default=abc",
			].join("\n"),
		);
		expect(fields.get("Application.runtime")).toBe(
			"runtime/org.freedesktop.Platform/x86_64/26.08",
		);
		expect(fields.get("Instance.flatpak-version")).toBe("1.17.0");
		// only the first = splits
		expect(fields.get("Instance.runtime-extensions")).toBe(
			"org.freedesktop.Platform.GL.default=abc",
		);
	});
});

describe("describeRef", () => {
	test("names a ref by its id and branch", () => {
		expect(describeRef("runtime/org.freedesktop.Platform/x86_64/26.08")).toBe(
			"org.freedesktop.Platform 26.08",
		);
		expect(describeRef("odd")).toBe("odd");
	});
});
