// The download buttons. Each is a link to the downloads page, and stays one
// without JavaScript, or on a phone, a tablet, or any computer there isn't a build
// for. Here, on a computer there is one for, it becomes a link to that file:
// "Download for macOS", with a note under it saying which build it is.
//
// On the downloads page, this also marks this computer's build in the list, or
// says why there isn't one, and puts copy buttons on the commands.
//
//   <a data-download aria-describedby="note">   the button
//     <span data-label>Download</span>          its label
//   <p id="note" hidden>                        its note, shown with the build
//     <span data-text></span>                   which build, and after a click,
//     <a data-more href="./download/">          how to install it (and the link
//                                               goes to the instructions)
//   [data-download-pick hidden]                 shown if there's a build
//   [data-unsupported="mobile 32-bit" hidden]   shown if there isn't, and why

import release from "virtual:release";
import { detect, detectOs, type Platform } from "./platform";
import { platformTabs, type Desktop } from "./platformTabs";
import { formatSize, type Asset, type Release } from "./release";

const NAMES: Record<Desktop, string> = {
	macos: "macOS",
	windows: "Windows",
	linux: "Linux",
};

interface Option {
	key: string; // in Release.assets
	detail: string; // which build it is, for the note
	after: string; // what to do with it once it's downloaded
}

interface Choice extends Option {
	os: Desktop;
	asset: Asset;
}

const UNZIP_MAC = "Unzip it, then drag Observatory into Applications.";

// the builds that would run here, best first
function options(p: Platform): Option[] {
	const { os, arch } = p;
	if (os === "macos") {
		const own =
			arch === "x64"
				? { arch: "x64", detail: "Intel" }
				: { arch: "arm64", detail: "Apple silicon" };
		return [own, { arch: "universal", detail: "Universal" }].flatMap((b) => [
			{
				key: `darwin-${b.arch}.dmg`,
				detail: b.detail,
				after: "Open it, then drag Observatory into Applications.",
			},
			{ key: `darwin-${b.arch}.zip`, detail: b.detail, after: UNZIP_MAC },
		]);
	}
	if (os === "windows") {
		// Windows 11 on Arm runs x64 apps too, for a release without an Arm build
		const builds =
			arch === "x64"
				? [{ arch: "x64", name: "64-bit", how: "" }]
				: arch === "arm64"
					? [
							{ arch: "arm64", name: "Arm", how: "" },
							{ arch: "x64", name: "x64", how: ", emulated on Arm" },
						]
					: [];
		return builds.flatMap((b) => [
			{
				key: `win32-${b.arch}.exe`,
				detail: `${b.name} installer${b.how}`,
				after: "Run the installer, and Observatory opens when it's done.",
			},
			{
				key: `win32-${b.arch}.zip`,
				detail: `${b.name} portable build${b.how}`,
				after: "Unzip it anywhere, and run Observatory.exe.",
			},
		]);
	}
	if (os === "linux" && arch !== "x86" && arch !== "arm32") {
		const a = arch ?? "x64";
		return [
			{
				key: `linux-${a}.flatpak`,
				detail: `Flatpak, ${a}`,
				after: "Open it with your software center, or flatpak install it.",
			},
			{
				key: `linux-${a}.zip`,
				detail: `${a}, .zip`,
				after: "Unzip it anywhere, and run Observatory.",
			},
		];
	}
	return [];
}

function choose(p: Platform, r: Release): Choice | undefined {
	if (p.os !== "macos" && p.os !== "windows" && p.os !== "linux") return;
	for (const o of options(p)) {
		const asset = r.assets[o.key];
		if (asset) return { ...o, os: p.os, asset };
	}
	return undefined;
}

function whyNot(p: Platform): string {
	if (p.os === "mobile" || p.os === "chromeos") return p.os;
	if (p.os === "macos" && p.arch === "x64") return "intel-mac";
	if (p.arch === "x86" || p.arch === "arm32") return "32-bit";
	return "other";
}

function offer(button: HTMLAnchorElement, c: Choice, r: Release): void {
	button.href = c.asset.url;
	button.dataset["ready"] = "";
	const label = button.querySelector("[data-label]");
	if (label) label.textContent = `Download for ${NAMES[c.os]}`;

	const note = document.getElementById(
		button.getAttribute("aria-describedby") ?? "",
	);
	const text = note?.querySelector("[data-text]");
	if (!note || !text) return;
	text.textContent = `${c.detail} · ${formatSize(c.asset.size)} · v${r.version}`;
	note.hidden = false;
	button.addEventListener("click", () => {
		text.textContent = c.after;
		const more = note.querySelector<HTMLAnchorElement>("a[data-more]");
		if (more) {
			more.hash = c.os;
			more.textContent = "Help installing";
		}
	});
}

function show(selector: string): void {
	for (const el of document.querySelectorAll<HTMLElement>(selector)) {
		el.hidden = false;
	}
}

function copyButtons(): void {
	if (!navigator.clipboard) return;
	for (const pre of document.querySelectorAll<HTMLElement>("pre[data-copy]")) {
		const code = pre.querySelector("code");
		const button = document.createElement("button");
		button.type = "button";
		button.className = "copy";
		button.textContent = "Copy";
		let reset: ReturnType<typeof setTimeout> | undefined;
		button.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(code?.textContent?.trim() ?? "");
				button.textContent = "Copied";
			} catch {
				button.textContent = "Couldn't copy";
			}
			clearTimeout(reset);
			reset = setTimeout(() => (button.textContent = "Copy"), 1600);
		});
		pre.prepend(button);
	}
}

async function main(): Promise<void> {
	copyButtons();
	// on the downloads page, open this computer's platform (or the one linked to)
	const os = detectOs();
	const tabs = platformTabs(
		os === "windows" || os === "linux" ? os : "macos",
	);
	const platform = await detect();
	const r = release;
	const choice = r && choose(platform, r);
	if (!r || !choice) {
		// with no release to offer (in dev), there's nothing to say about one
		if (r || !options(platform).length) {
			show(`[data-unsupported~="${whyNot(platform)}"]`);
		}
		return;
	}
	for (const button of document.querySelectorAll<HTMLAnchorElement>(
		"a[data-download]",
	)) {
		offer(button, choice, r);
	}
	// on the downloads page: this computer's build, marked in the list
	tabs?.markYours(choice.os);
	if (!tabs?.picked) tabs?.select(choice.os);
	document
		.querySelector(`li[data-asset="${choice.key}"]`)
		?.classList.add("yours");
	// and the commands name its file (the arm64 Flatpak, not the x64 one)
	const kind = (key: string) => key.replace(/-[^.]+/, "");
	for (const el of document.querySelectorAll<HTMLElement>(
		"[data-asset-name]",
	)) {
		if (kind(el.dataset["assetName"] ?? "") === kind(choice.key)) {
			el.textContent = choice.asset.name;
		}
	}
	show("[data-download-pick]");
}

void main();
