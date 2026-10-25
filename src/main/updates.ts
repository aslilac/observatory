import { app, autoUpdater, net, shell } from "electron";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { broadcast } from "./broadcast";
import { isNewer } from "./version";

// New versions come out as GitHub releases (.github/workflows/release.yaml).
// Where it can, the app updates itself: Squirrel asks update.electronjs.org,
// which reads those releases, downloads the new version, and it's there
// from the next start. That's Windows, installed with the Setup.exe, and
// macOS, if the app's signed with a Developer ID (Squirrel.Mac only takes
// an update signed by the same team). Everywhere else (Linux, the zips, an
// ad hoc signature, Windows on Arm), it says when a new version is out,
// and opens its release page to download it from. Prereleases don't count,
// either way.

const REPO = "aslilac/observatory";
const HOUR = 60 * 60 * 1000;

let update: Ob.Update | null = null;
let releasePage: string | null = null;

function setUpdate(next: Ob.Update) {
	update = next;
	broadcast("Ob.update", update);
}

export function getUpdate(): Ob.Update | null {
	return update;
}

// Restarts into the downloaded update, or opens the new version's page.
export function applyUpdate() {
	if (update?.status === "downloaded") {
		autoUpdater.quitAndInstall();
	} else if (releasePage) {
		void shell.openExternal(releasePage);
	}
}

export function startUpdates() {
	if (!app.isPackaged) {
		return;
	}
	void updatesItself().then((squirrel) => {
		const check = squirrel ? startSquirrel() : checkReleases;
		const checkUnlessDownloaded = () => {
			if (update?.status !== "downloaded") {
				void check();
			}
		};
		// The first time the app runs after it's installed, Squirrel's still
		// holding on to the install, so that check waits for the next.
		if (!process.argv.includes("--squirrel-firstrun")) {
			checkUnlessDownloaded();
		}
		setInterval(checkUnlessDownloaded, HOUR);
	});
}

async function updatesItself(): Promise<boolean> {
	switch (process.platform) {
		case "win32":
			// The Setup.exe puts Squirrel's Update.exe next to the folder the
			// app runs from. Each release has one list of Squirrel packages,
			// update.electronjs.org takes it for every arch, and it's x64's.
			return (
				process.arch === "x64" &&
				fs.existsSync(path.resolve(process.execPath, "../../Update.exe"))
			);
		case "darwin":
			return signedByTeam();
		default:
			return false;
	}
}

// Apple silicon needs every app signed, but an ad hoc signature names no
// team, and then each version is signed by no one in particular: Squirrel.Mac
// would download an update only to turn it down.
async function signedByTeam(): Promise<boolean> {
	const bundle = path.resolve(process.execPath, "../../..");
	try {
		const { stderr } = await promisify(execFile)("codesign", [
			"--display",
			"--verbose=2",
			bundle,
		]);
		return /^TeamIdentifier=(?!not set$)/m.test(stderr);
	} catch {
		return false;
	}
}

function startSquirrel() {
	autoUpdater.on("update-downloaded", () => {
		setUpdate({ status: "downloaded" });
	});
	// Then it can at least say there's a new version.
	autoUpdater.on("error", () => {
		void checkReleases();
	});
	autoUpdater.setFeedURL({
		url: `https://update.electronjs.org/${REPO}/${process.platform}-${process.arch}/${app.getVersion()}`,
	});
	return () => autoUpdater.checkForUpdates();
}

// GitHub's latest release is the newest that isn't a prerelease. Until
// there is one, it's not found.
async function checkReleases() {
	try {
		const response = await net.fetch(
			`https://api.github.com/repos/${REPO}/releases/latest`,
			{ headers: { accept: "application/vnd.github+json" } },
		);
		if (!response.ok) {
			return;
		}
		const release = (await response.json()) as {
			tag_name: string;
			html_url: string;
		};
		const version = release.tag_name.replace(/^v/, "");
		if (update?.status !== "downloaded" && isNewer(version, app.getVersion())) {
			releasePage = release.html_url;
			setUpdate({ status: "available", version });
		}
	} catch {
		// offline, or GitHub's having a moment: there's the next check
	}
}
