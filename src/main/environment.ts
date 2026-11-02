// What this copy of Observatory is and what it's running on, for the about
// window and to fill in a bug report: the build (its commit, and which of
// the ways it ships), the OS and architecture, and on Linux the kernel, the
// desktop, and a Flatpak's runtime.
import { app, shell } from "electron";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describeRef, parseKeyFile, parseOsRelease } from "./keyFiles";
import { installedWithSetup, signedWithCertificate } from "./updates";

const ISSUES = "https://github.com/aslilac/observatory/issues";

let environment: Promise<Ob.Environment> | null = null;

// It doesn't change while the app runs, so it's read once.
export function getEnvironment(): Promise<Ob.Environment> {
	environment ??= readEnvironment();
	return environment;
}

async function readEnvironment(): Promise<Ob.Environment> {
	const flatpak = process.platform === "linux" ? await readFlatpakInfo() : null;
	const details: Ob.Detail[] = [
		{ label: "Build", value: await describeBuild(flatpak !== null) },
		{ label: "System", value: await describeSystem(flatpak !== null) },
		{ label: "Architecture", value: describeArch() },
	];
	if (process.platform === "linux") {
		details.push({ label: "Kernel", value: os.release() });
		const desktop = describeDesktop();
		if (desktop) {
			details.push({ label: "Desktop", value: desktop });
		}
	}
	if (flatpak) {
		details.push(...flatpak);
	}
	details.push({
		label: "Electron",
		value: `${process.versions.electron} (Chromium ${process.versions.chrome})`,
	});
	return { version: describeVersion(), details };
}

// "1.2.0 (53410bd)", or "(53410bd, modified)" when built from a checkout
// with changes.
function describeVersion(): string {
	const version = app.getVersion();
	if (!__COMMIT__) {
		return version;
	}
	const [sha, dirty] = __COMMIT__.split("-");
	const commit = sha!.slice(0, 7);
	return `${version} (${dirty ? `${commit}, modified` : commit})`;
}

// Which of the ways the app ships this is, where there's more than one.
async function describeBuild(flatpak: boolean): Promise<string> {
	if (!app.isPackaged) {
		return "Development";
	}
	switch (process.platform) {
		case "win32":
			return installedWithSetup() ? "Installer" : "Portable (.zip)";
		case "darwin":
			// Only one signed with a certificate updates itself.
			return (await signedWithCertificate())
				? "Signed with a certificate"
				: "Signed ad hoc";
		case "linux":
			return flatpak ? "Flatpak" : "Zip";
		default:
			return "Zip";
	}
}

async function describeSystem(flatpak: boolean): Promise<string> {
	const version = process.getSystemVersion();
	switch (process.platform) {
		case "darwin":
			return `macOS ${version}`;
		case "win32": {
			// Windows 11 still calls itself 10.0, from build 22000 on.
			const build = Number(version.split(".")[2]);
			return `Windows ${build >= 22000 ? 11 : 10} (${version})`;
		}
		case "linux": {
			// A Flatpak's /etc/os-release is its runtime's; the host's is
			// passed in at /run/host.
			const release = await readFirst(
				flatpak
					? ["/run/host/os-release"]
					: ["/etc/os-release", "/usr/lib/os-release"],
			);
			const fields = release ? parseOsRelease(release) : null;
			return fields?.get("PRETTY_NAME") ?? fields?.get("NAME") ?? "Linux";
		}
		default:
			return `${process.platform} ${os.release()}`;
	}
}

// An x64 build on an Arm Mac or PC runs translated.
function describeArch(): string {
	if (!app.runningUnderARM64Translation) {
		return process.arch;
	}
	return process.platform === "darwin"
		? `${process.arch} (Rosetta)`
		: `${process.arch} (emulated on arm64)`;
}

// "GNOME, Wayland", where the title bar and the window buttons come from.
function describeDesktop(): string | null {
	const desktop = process.env["XDG_CURRENT_DESKTOP"]?.split(":").join(", ");
	const session = process.env["XDG_SESSION_TYPE"];
	const sessionName =
		session === "wayland" ? "Wayland" : session === "x11" ? "X11" : session;
	return [desktop, sessionName].filter(Boolean).join(", ") || null;
}

// The runtime it runs on and the Electron base app it was built with (from
// the manifest flatpak-builder leaves in /app), and Flatpak's own version.
// Null outside a Flatpak.
async function readFlatpakInfo(): Promise<Ob.Detail[] | null> {
	const text = await readFirst(["/.flatpak-info"]);
	if (text === null) {
		return null;
	}
	const info = parseKeyFile(text);
	const details: Ob.Detail[] = [];
	const runtime = info.get("Application.runtime");
	if (runtime) {
		details.push({ label: "Runtime", value: describeRef(runtime) });
	}
	try {
		const manifest = JSON.parse(
			await fs.readFile("/app/manifest.json", "utf8"),
		) as { "base"?: string; "base-version"?: string };
		if (manifest.base) {
			details.push({
				label: "Base",
				value: [manifest.base, manifest["base-version"]]
					.filter(Boolean)
					.join(" "),
			});
		}
	} catch {
		// built without one
	}
	const version = info.get("Instance.flatpak-version");
	if (version) {
		details.push({ label: "Flatpak", value: version });
	}
	return details;
}

async function readFirst(paths: string[]): Promise<string | null> {
	for (const path of paths) {
		try {
			return await fs.readFile(path, "utf8");
		} catch {
			// try the next
		}
	}
	return null;
}

// A new issue on GitHub, with what it's running on filled in under where
// the user writes what happened.
export function newIssueUrl(environment: Ob.Environment): string {
	const rows = [
		{ label: "Version", value: environment.version },
		...environment.details,
	].map(({ label, value }) => `| ${label} | ${value.replaceAll("|", "\\|")} |`);
	const body = [
		"<!-- What happened, and what did you expect to happen? -->",
		"",
		"",
		"",
		"<!-- Filled in by Observatory. -->",
		"| | |",
		"| --- | --- |",
		...rows,
	].join("\n");
	return `${ISSUES}/new?body=${encodeURIComponent(body)}`;
}

export async function reportIssue() {
	await shell.openExternal(newIssueUrl(await getEnvironment()));
}
