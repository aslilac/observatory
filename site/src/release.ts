// The release the site offers: its version, and its files by what they're for
// ("darwin-arm64.zip"). It's read from GitHub when the site is built
// (release-plugin.ts), and the pages get it from `virtual:release`.

export interface Asset {
	name: string;
	url: string;
	size: number; // bytes
}

export interface Release {
	version: string; // "1.0.0-beta.1"
	notes: string; // the release's page on GitHub
	date: string; // when it was published, ISO 8601
	prerelease: boolean;
	assets: Record<string, Asset>;
}

export const RELEASES = "https://github.com/aslilac/observatory/releases";

// the parts of GitHub's release JSON the site uses
export interface GitHubRelease {
	tag_name: string;
	html_url: string;
	published_at: string | null;
	draft: boolean;
	prerelease: boolean;
	assets: {
		name: string;
		browser_download_url: string;
		size: number;
		state?: string;
	}[];
}

// "Observatory-darwin-arm64-1.0.0-beta.1.zip" is "darwin-arm64.zip". Squirrel's
// installer ("Observatory-1.0.0-beta.1.Setup.exe") doesn't say, and is for x64.
export function assetKey(name: string): string | undefined {
	const kind = /\.(zip|flatpak|exe|dmg|deb|rpm|AppImage)$/.exec(name)?.[1];
	if (!kind) return undefined;
	const target =
		/(darwin|linux|win32)-(x64|arm64|universal)/.exec(name)?.[0] ??
		(kind === "exe" ? "win32-x64" : undefined);
	return target && `${target}.${kind}`;
}

// The newest release with files to download: the newest stable one, or if
// there isn't one yet, the newest prerelease.
export function pickRelease(list: readonly GitHubRelease[]): Release | null {
	const ready = list.filter((r) => !r.draft && r.assets.length > 0);
	const r = ready.find((r) => !r.prerelease) ?? ready[0];
	if (!r) return null;
	const assets: Record<string, Asset> = {};
	for (const a of r.assets) {
		const key = assetKey(a.name);
		if (!key || (a.state && a.state !== "uploaded")) continue;
		assets[key] = { name: a.name, url: a.browser_download_url, size: a.size };
	}
	return {
		version: r.tag_name.replace(/^v/, ""),
		notes: r.html_url,
		date: r.published_at ?? "",
		prerelease: r.prerelease,
		assets,
	};
}

// in MB as the OS shows them (and as GitHub does)
export function formatSize(bytes: number): string {
	return `${Math.round(bytes / 2 ** 20)} MB`;
}

export function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}
