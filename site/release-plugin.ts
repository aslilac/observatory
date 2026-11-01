// Puts the latest release in the site, read from GitHub once per build (or dev
// server start), so the download links work without JavaScript and without a
// request to GitHub from every visitor. Rebuild the site after a release.
//
// GitHub's "latest release" links skip prereleases, so they can't be used while
// every release is a beta. Set GITHUB_TOKEN if the API rate limit gets in the way.
//
// In the pages' HTML:
//   <li data-asset="darwin-arm64.zip">  its first href becomes the file's link, and
//                                       its <span class="size"> the file's size. If
//                                       the release doesn't have that file, the
//                                       <li> is left out.
//   data-asset-name="linux-x64.flatpak" the element's text becomes the file's name
//   data-release="version" | "date"     the element's text becomes the version or
//                                       the date (and a date is unhidden)
//   data-release="notes"                its href becomes the release's page
// The scripts get the release from `virtual:release` (null if it couldn't be read,
// in dev; the build stops instead).

import type { Plugin } from "vite";
import {
	formatDate,
	formatSize,
	pickRelease,
	type GitHubRelease,
	type Release,
} from "./src/release.ts";

const API =
	"https://api.github.com/repos/aslilac/observatory/releases?per_page=20";
const ID = "virtual:release";

async function fetchRelease(): Promise<Release> {
	const token = process.env["GITHUB_TOKEN"];
	const res = await fetch(API, {
		headers: {
			"accept": "application/vnd.github+json",
			"user-agent": "observatory-site",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) {
		const limited = res.status === 403 || res.status === 429;
		throw new Error(
			`GitHub answered ${res.status}${limited ? " (rate limited? set GITHUB_TOKEN)" : ""}`,
		);
	}
	const release = pickRelease((await res.json()) as GitHubRelease[]);
	if (!release) throw new Error("there's no published release with files");
	return release;
}

export function fill(html: string, r: Release): string {
	return (
		html
			.replace(
				/<li\b[^>]*\bdata-asset="([^"]+)"[^>]*>[\s\S]*?<\/li>/g,
				(li, key: string) => {
					const a = r.assets[key];
					if (!a) return "";
					return li
						.replace(/\bhref="[^"]*"/, `href="${a.url}"`)
						.replace(
							/(<span\b[^>]*\bclass="size"[^>]*>)[^<]*/,
							`$1${formatSize(a.size)}`,
						);
				},
			)
			.replace(
				/(<[^>]*\bdata-asset-name="([^"]+)"[^>]*>)[^<]*/g,
				(all, open: string, key: string) => {
					const a = r.assets[key];
					return a ? open + a.name : all;
				},
			)
			// <time data-release="date" hidden> gets its date, and is shown
			.replace(
				/<(\w+)([^>]*)\bdata-release="(version|date)"([^>]*)>[^<]*/g,
				(_, tag: string, before: string, what: string, after: string) => {
					const attrs = `${before}data-release="${what}"${after}`;
					if (what === "version") return `<${tag}${attrs}>${r.version}`;
					const shown = attrs.replace(/\s+hidden\b/, "");
					return `<${tag}${shown} datetime="${r.date}">${formatDate(r.date)}`;
				},
			)
			.replace(/(<a\b[^>]*\bdata-release="notes"[^>]*>)/g, (a: string) =>
				a.replace(/\bhref="[^"]*"/, `href="${r.notes}"`),
			)
	);
}

export function release(): Plugin {
	let release: Promise<Release | null> = Promise.resolve(null);
	return {
		name: "observatory-release",
		configResolved(config) {
			release = fetchRelease().then(
				(r) => {
					config.logger.info(
						`release: ${r.version} (${Object.keys(r.assets).join(", ")})`,
					);
					return r;
				},
				(e: unknown) => {
					const why = `couldn't read the latest release from GitHub: ${e instanceof Error ? e.message : String(e)}`;
					// a downloads page without downloads shouldn't be published
					if (config.command === "build") throw new Error(why);
					config.logger.warn(
						`release: ${why}. The download links go to GitHub's list.`,
					);
					return null;
				},
			);
			// handled where it's awaited; this keeps a failure from being unhandled
			release.catch(() => {});
		},
		async buildStart() {
			await release;
		},
		resolveId(id) {
			return id === ID ? `\0${ID}` : undefined;
		},
		async load(id) {
			if (id !== `\0${ID}`) return undefined;
			return `export default ${JSON.stringify(await release)};`;
		},
		transformIndexHtml: {
			order: "pre",
			async handler(html) {
				const r = await release;
				return r ? fill(html, r) : html;
			},
		},
	};
}
