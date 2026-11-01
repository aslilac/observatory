// What kind of computer is looking at the page: its OS and its processor.
//
// Chromium browsers say both when asked (User-Agent Client Hints). Elsewhere it's
// the user agent string, which says the OS, and on Windows and Linux, mostly the
// processor. On a Mac, Safari and Firefox say "Intel" whatever the Mac has, so the
// graphics are the clue: Firefox names an Intel, AMD or NVIDIA GPU, and Safari
// says only "Apple GPU". So a Mac is taken to have Apple silicon unless something
// says otherwise.

export type Os =
	| "macos"
	| "windows"
	| "linux"
	| "mobile"
	| "chromeos"
	| "other";
export type Arch = "arm64" | "x64" | "arm32" | "x86";

export interface Platform {
	os: Os;
	arch: Arch | undefined; // undefined if it couldn't tell
}

// navigator.userAgentData, where there is one (not in TypeScript's DOM types)
interface UAData {
	platform: string;
	mobile: boolean;
	getHighEntropyValues(
		hints: string[],
	): Promise<{ architecture?: string; bitness?: string }>;
}

export async function detect(): Promise<Platform> {
	const uad = (navigator as Navigator & { userAgentData?: UAData })
		.userAgentData;
	const os = whichOs(navigator.userAgent, uad);
	if (os !== "macos" && os !== "windows" && os !== "linux") {
		return { os, arch: undefined };
	}
	return { os, arch: await whichArch(os, uad) };
}

function whichOs(ua: string, uad: UAData | undefined): Os {
	const p = uad?.platform ?? "";
	if (/Android|iPhone|iPad|iPod/.test(ua) || p === "Android" || p === "iOS") {
		return "mobile";
	}
	if (/CrOS/.test(ua) || p === "Chrome OS") return "chromeos";
	if (uad?.mobile) return "mobile";
	if (p === "macOS" || /Macintosh|Mac OS X/.test(ua)) {
		// an iPad asks for the desktop site as a Mac, but Macs don't have touch
		return navigator.maxTouchPoints > 1 ? "mobile" : "macos";
	}
	if (p === "Windows" || /Windows/.test(ua)) return "windows";
	if (p === "Linux" || /Linux|X11/.test(ua)) {
		// an Android tablet asking for the desktop site says it's Linux
		const touchOnly = matchMedia("(hover: none) and (pointer: coarse)").matches;
		return touchOnly ? "mobile" : "linux";
	}
	return "other";
}

async function whichArch(
	os: "macos" | "windows" | "linux",
	uad: UAData | undefined,
): Promise<Arch | undefined> {
	try {
		const v = await uad?.getHighEntropyValues(["architecture", "bitness"]);
		if (v?.architecture === "arm" || v?.architecture === "x86") {
			const wide = v.bitness !== "32";
			if (v.architecture === "arm") return wide ? "arm64" : "arm32";
			return wide ? "x64" : "x86";
		}
	} catch {
		// not allowed to say
	}

	const says = `${navigator.userAgent} ${navigator.platform}`;
	switch (os) {
		case "windows":
			if (/ARM64|aarch64/i.test(says)) return "arm64";
			// a 32-bit browser on 64-bit Windows says WOW64
			return /Win64|WOW64|x64|amd64/i.test(says) ? "x64" : "x86";
		case "linux":
			if (/aarch64|arm64|armv8/i.test(says)) return "arm64";
			if (/armv[67]|\barm\b/i.test(says)) return "arm32";
			if (/x86_64|amd64/i.test(says)) return "x64";
			if (/i[3-6]86/.test(says)) return "x86";
			return undefined;
		case "macos":
			return macGpu();
	}
}

function macGpu(): Arch | undefined {
	try {
		const gl = document.createElement("canvas").getContext("webgl");
		if (!gl) return undefined;
		const info = gl.getExtension("WEBGL_debug_renderer_info");
		const gpu = info
			? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
			: "";
		gl.getExtension("WEBGL_lose_context")?.loseContext();
		if (/Intel|AMD|Radeon|NVIDIA|GeForce/i.test(gpu)) return "x64";
		if (/Apple M\d/i.test(gpu)) return "arm64";
	} catch {
		// no WebGL
	}
	return undefined;
}
