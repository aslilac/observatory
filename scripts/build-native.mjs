// Build the rust-backend cdylib and copy it next to lib.rs as a .node file
// so the main process can `require()` it. Cross-platform: cargo produces
// `lib*.so` on Linux, `lib*.dylib` on macOS, `*.dll` (no lib prefix) on
// Windows — we normalize to `observatory_scan.node`.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cargoCwd = path.join(repoRoot, "rust-backend");

const extByPlatform = { linux: "so", darwin: "dylib", win32: "dll" };
const ext = extByPlatform[process.platform];
if (!ext) {
	console.error(`unsupported platform: ${process.platform}`);
	process.exit(1);
}
const stem = process.platform === "win32" ? "observatory_scan" : "libobservatory_scan";

const result = spawnSync(
	"cargo",
	["build", "--release", "--lib", "--features", "napi"],
	{ cwd: cargoCwd, stdio: "inherit" },
);
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

const src = path.join(cargoCwd, "build", "release", `${stem}.${ext}`);
const dst = path.join(cargoCwd, "observatory_scan.node");
await fs.copyFile(src, dst);
console.log(`built ${path.relative(repoRoot, dst)}`);
