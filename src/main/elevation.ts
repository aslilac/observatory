import { app, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { relaunchElevated } from "./native";

// Windows keeps an app that isn't running as an administrator out of system
// folders, other accounts' files, and some apps' data. The scanner reports
// those folders with kind "admin" (src/scanner/lib.rs), and this is the way
// in: start the app again as an administrator, which Windows asks the user
// about first, straight into a fresh scan of the same path.

const SCAN = "--scan=";

// The path this copy was started to scan right away, if it was.
export function scanArgument(argv: string[] = process.argv): string | null {
	const arg = argv.find((a) => a.startsWith(SCAN));
	return arg ? arg.slice(SCAN.length) || null : null;
}

// Resolves false if the user said no. Otherwise this copy quits, leaving
// the new one.
export function restartAsAdmin(
	event: IpcMainInvokeEvent,
	scan: string,
): boolean {
	const args = process.argv
		.slice(1)
		.filter((a) => !a.startsWith(SCAN) && !a.startsWith("--squirrel-"));
	// Out of a package, Electron was started on the project folder, by a
	// relative path. Windows doesn't promise the new copy the same working
	// folder.
	if (!app.isPackaged) {
		const project = args.findIndex((a) => !a.startsWith("-"));
		if (project !== -1) {
			args[project] = path.resolve(args[project]!);
		}
	}
	const window = BrowserWindow.fromWebContents(event.sender);
	const started = relaunchElevated(
		window?.getNativeWindowHandle() ?? null,
		process.execPath,
		[...args, `${SCAN}${scan}`],
		process.cwd(),
	);
	if (started) {
		app.quit();
	}
	return started;
}
