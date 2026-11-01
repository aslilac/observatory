import { app, autoUpdater, net, shell } from "electron";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { broadcast } from "./broadcast";
import { isNewer } from "./version";

// Each release goes up to a bucket as well as GitHub, laid out for Squirrel
// (the publish job in .github/workflows/release.yaml):
//
//   darwin/arm64/RELEASES.json   Squirrel.Mac's static manifest, and the zip
//   win32/<arch>/RELEASES        Squirrel.Windows' list, and the .nupkg
//   latest.json                  { version, url }, the release's GitHub page
//
// Where it can, the app updates itself from there: Squirrel downloads the new
// version, and it's there from the next start. That's Windows, installed
// with the Setup.exe, and macOS, if the app's signed with a certificate
// (Squirrel.Mac only takes an update signed the same way). Everywhere else
// (Linux, the zips, an ad hoc signature), it says when a new version is out,
// and opens its release page to download it from.

const FEED = "https://releases.mckayla.dev/observatory";
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
		const check = squirrel ? startSquirrel() : checkLatest;
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
			// app runs from.
			return fs.existsSync(path.resolve(process.execPath, "../../Update.exe"));
		case "darwin":
			return signedWithCertificate();
		default:
			return false;
	}
}

// Apple silicon needs every app signed, but an ad hoc signature is only of
// that one build, so each version looks like a different app: Squirrel.Mac
// would download an update only to turn it down. A certificate's signature
// names who signed it.
async function signedWithCertificate(): Promise<boolean> {
	const bundle = path.resolve(process.execPath, "../../..");
	try {
		const { stderr } = await promisify(execFile)("codesign", [
			"--display",
			"--verbose=2",
			bundle,
		]);
		return /^Authority=/m.test(stderr);
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
		void checkLatest();
	});
	const feed = `${FEED}/${process.platform}/${process.arch}`;
	autoUpdater.setFeedURL(
		process.platform === "darwin"
			? { url: `${feed}/RELEASES.json`, serverType: "json" }
			: { url: feed },
	);
	return () => autoUpdater.checkForUpdates();
}

async function checkLatest() {
	try {
		const response = await net.fetch(`${FEED}/latest.json`, {
			cache: "no-cache",
		});
		if (!response.ok) {
			return;
		}
		const latest = (await response.json()) as { version: string; url: string };
		if (
			update?.status !== "downloaded" &&
			isNewer(latest.version, app.getVersion())
		) {
			releasePage = latest.url;
			setUpdate({ status: "available", version: latest.version });
		}
	} catch {
		// offline, or the bucket's having a moment: there's the next check
	}
}
