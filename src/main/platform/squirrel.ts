// Compatibility with the Squirrel updater for Windows. Squirrel invokes
// our launcher with `--squirrel-install` / `--squirrel-updated` / etc.
// during install + auto-update, and the package's check() spawns the
// matching Update.exe call and returns true so we can exit before any UI
// shows.
//
// Lazy-required behind a platform gate so macOS / Linux bundles never
// touch the module at all — the package does `var app =
// require("electron").app` at file scope and the way the rolldown bundle
// reifies that has been observed to break macOS builds. The check is a
// no-op off Windows anyway, so dodging it entirely is the right move.

import { createRequire } from "node:module";

if (process.platform === "win32") {
	const require = createRequire(import.meta.url);
	const squirrel = require("electron-squirrel-startup") as boolean;
	if (squirrel) {
		process.exit(0);
	}
}
