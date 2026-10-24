# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Observatory is a cross-platform Electron desktop app for visualizing disk usage (think DaisyDisk). The filesystem traversal lives in `src/scanner/` (rayon-based parallel scanner) and is loaded by the main process as a napi-rs cdylib; the TypeScript app wraps it with the UI, IPC, and render-tree pruning.

## Common commands

Package manager: **yarn** (yarn.lock is the source of truth; no committed package-lock.json). Scripts in `package.json` invoke `npm run …` internally — that's fine, both yarn and npm honor those. **Future migration:** plan to switch to pnpm — better disk usage and stricter dependency resolution. Don't do it incrementally.

Node: see `.nvmrc` (currently 22 LTS). Electron bundles its own Node, so this only governs build-side tooling.

- `yarn` — install deps. After install, run `yarn build.native` once to build the napi-rs scanner (`src/scanner/observatory_scan.node`).
- `yarn build.native` — `node scripts/build-native.mjs`. Runs `cargo build --release --lib --features napi` in `src/scanner/`, then copies/renames the produced cdylib (libobservatory_scan.so/.dylib/.dll, in `target/release/`) to `src/scanner/observatory_scan.node`. Required before the main process can start — `vfsManager` requires this at module load.
- `yarn dev` — `electron-vite dev`. Vite serves the renderer with HMR (typically `http://localhost:5173`); main + preload are bundled with esbuild and Electron auto-restarts on main-process changes. One process, one log stream.
- `yarn build` — `electron-vite build`. Bundles all three processes into `build/main/index.js`, `build/preload/index.js`, and `build/renderer/` (multi-entry: `index.html` + `about.html`).
- `yarn build.forge` — `build.native` + `build` + `electron-forge make`. DMG (macOS), Squirrel (win32), and zip artifacts.
- `flatpak/build.sh` — on Linux, builds the Flatpak (`flatpak/ooo.lilac.observatory.yml`) from the checkout with flatpak-builder and installs it for the user. The manifest builds everything inside the SDK (pnpm install, `build-native.mjs`, `electron-vite build`, `electron-forge package`) on the Electron base app, and installs the icons from `build-resources/hicolor` (copied there by `icon/build.sh`). It has `--filesystem=host-root` (Flatpak 1.17+), so the whole host, mounts and all, is at `/run/host/root` in the sandbox. Reveal maps those paths back to the host's (`hostPath` in `src/main/ipc.ts`), since the file manager runs outside.
- `icon/build.sh` — regenerates the app icons (Blender, `uv`, Xcode 26+) and copies what ships (`icon.icns`, `Assets.car` for macOS 26, `icon.ico`, `icon.png`, and the About window's per-platform `about/*.png`) into `build-resources/`, which `forge.config.js` reads. See `icon/README.md`.
- `yarn preview` — `electron-vite preview`. Runs the packaged build without rebuilding — useful to verify `file://` loading for the renderer.
- `yarn check.types` — `tsc -b .` over the whole project.
- `yarn check.test` (or `yarn test`) — Vitest, single run. `yarn check.test.w` for the watcher.
- `yarn fmt` — oxfmt write. `yarn check.lint` — oxlint with `--fix`.
- Rust backend: `cargo test` from the repo root — runs the library unit tests against ephemeral tmp directories. No hardcoded paths.

Build config lives in `electron.vite.config.ts` at the root — one file for all three processes. Renderer uses `@vitejs/plugin-react` and `@tailwindcss/vite` (Tailwind v4); main and preload use `externalizeDepsPlugin()` so runtime `dependencies` stay external. That makes `dependencies` only what main loads from `node_modules` at runtime (just `electron-squirrel-startup`): everything the bundles inline (React, Base UI, lucide, the fonts) goes in `devDependencies`, which Forge prunes out of the asar. `forge.config.js`'s `ignore` is an allowlist of what goes in it.

In dev, the main process reads `process.env.ELECTRON_RENDERER_URL` and loads from it; in packaged builds it falls back to `loadFile("../renderer/index.html")`. Same pattern for the about window.

## Architecture

Main owns the truth; renderer is a view that asks for it. Communication is plain RPC + push events — no shared state, no synced store.

### Process layout

- **Main** (`src/main/`) — Node-side. Owns drive list and active scans (`vfsManager.ts`). The actual filesystem traversal happens in Rust via the napi-rs binding (`native.ts` loads `src/scanner/observatory_scan.node`), and the finished tree stays there: main only proxies queries to it. `renderTree.ts` adds the JS-side glue (drive label/capacity, alphabetical sort) to the slices Rust hands back. Window management lives here too. Entry: `src/main/index.ts`.
- **Preload** (`src/preload/index.ts`) — exposes the typed `Ob.*` surface to the renderer via `contextBridge`. Each method is a thin wrapper over `ipcRenderer.invoke` (RPC) or `ipcRenderer.on` (push events).
- **Renderer** (`src/renderer/`) — React 18 UI. Entry: `main.tsx` mounting `<Application/>`. UI state is local React state; cross-process data comes from custom hooks in `src/renderer/state.ts`.

### The Ob surface (declared in `src/@types/Observatory.d.ts`)

RPC: `selectDirectory`, `scanPath`, `getDrives`, `getScans`, `getRenderTree(path, cursor)`. Subscriptions (each returns an unsubscribe): `onDrives`, `onScans`, `onSetInspecting`. The `onDrives` / `onScans` subscriptions also fire once with the current state immediately after subscribing, so renderer hooks don't need a separate initial fetch. Windows-only: `restartAsAdmin(path)` (see the scanning flow). Windows and Linux: `setTitleBarTheme`, `getAppMenu`, `popupAppMenu` for the title bar (see Renderer UI).

### State ownership

- **Main**: `vfsManager.ts` holds two `Map`s — `drives` (the native `volumes()`, polled every 5s) and `scans` (`{ status, scan, drive, errors, perf, revision }` per path). The `scan` field is the native handle: it runs the walk, then holds the finished tree for the life of the entry (`cancelScan` releases it). `drive` is the label/capacity of a whole-disk scan, which the drive-agnostic scanner can't know. It exposes pure getters (`getDrives`, `getScans`, `getRenderTree`, …) and a `startScan(path)` mutator. Changes are emitted through a Node `EventEmitter`; `bridge.ts` subscribes and re-broadcasts to all `webContents.send(...)`.
- **Renderer**: `Application.tsx` keeps `inspecting: string | null` and `cursor: string[]` in `useState`. `useDrives()` / `useScans()` hooks subscribe to the corresponding push events. `useRenderTree(path, cursor, status)` calls `Ob.getRenderTree` whenever path/cursor/status changes and the scan is `complete`.

### Scanning flow

1. User clicks Scan → `Ob.scanPath(path)` → `vfsManager.startScan(path)`.
2. `startScan` constructs a native `Scan` (`new Scan(path, { perf: false })` — stats the root synchronously), inserts `{ status: "building", scan, root: null, … }` into the `scans` map, emits `scans` change → broadcast, and calls `scan.start()` (returns a Promise; the recursive walk runs on libuv's threadpool inside the Rust addon).
3. The renderer can poll `Ob.getScanProgress(path)` while the walk runs; the manager reads `counts` and `currentPath` directly off the native handle via `scan.progress()`.
4. When `scan.start()` resolves (with a `{ counts, errors, perf }` summary — the tree stays on the handle), the manager copies the errors and perf onto the entry, records the drive info, flips status to `complete`, and emits.
5. The renderer sees the status flip via `useScans` and refetches the render tree via `Ob.getRenderTree(path, cursor)`.

`Ob.scanPath` is a no-op for a path that's already scanned (or scanning), so opening a recent just shows the existing result. Rescan (right-click a disk or folder on the home screen) goes through `Ob.rescanPath` → `vfsManager.rescan`, which releases the finished handle and starts the flow over.

The tree never crosses into JS: a whole disk is millions of nodes, too much for Electron's 4 GB V8 heap and too long for one V8 string. `scan.renderTree(cursor)` cuts a slice in Rust (`src/scanner/tree.rs`): entries smaller than 0.3% of the current directory are dropped from the sunburst, and recursion is capped at depth 6. `assembleRenderTree` (in `renderTree.ts`) turns that into an `Ob.RenderTree`. Search (`scan.search`, off the main thread, capped at 500 hits) and post-trash removal (`scan.remove`) go through the handle the same way.

The Rust scanner skips `/dev` and `/proc` on Linux and `/Volumes`, `/System/Volumes`, `/private/var/db/dyld` (plus anything under `/System/Volumes/*`) on macOS to avoid Catalina+ firmlink shadow paths and recursive procfs/sysfs mounts. On Linux, where a scan goes among mounts comes from `/proc/self/mountinfo` (`src/scanner/mounts.rs`, the plan is made once per scan): into every mount of the scanned disk it can reach (btrfs subvolumes, which `st_dev` can't tell apart from other disks), into a folder a bind mount shows only once (at its shallowest place, or where it already was on a tie: an ostree system's `/etc` counts at `/etc`, not in the deployment under `/sysroot`), and not into other filesystems. Nested btrfs subvolumes that aren't mounted are gone into too. An ostree system's `/` with composefs is a read-only image of the deployment, so a scan of it counts only the mounts in it. Without a mount table (Windows), cross-device descent is rejected (never on macOS, because firmlinks break the dev-id check). A file with several hard links (`nlink > 1`, so not on Windows) counts once, at the link whose path sorts first; links that lose out to one found later are zeroed and their folders re-totalled after the walk. Symlinks, character/block devices, and unknowns are counted but not added to the tree. File sizes are allocated space (`st_blocks × 512`), not length, so sparse disk images (Docker, VMs) count what they actually occupy; Windows falls back to length. Permission errors on folders another account owns, and macOS EPERM refusals outside the home folder (SIP, data vaults), aren't reported as issues: they're locked on every Mac. The scan root's own failure always is. EPERM inside the home folder (Mail, Messages, other apps' containers) is reported with kind `protected`, which the renderer folds into one issue with an "Open System Settings" button (`Ob.openFullDiskAccessSettings`, a deep link to the Full Disk Access pane). Whether the app has Full Disk Access is checked once per scan by trying to list `~/Library/Application Support/com.apple.TCC`; once it does, every remaining EPERM is dropped as expected. In dev the grant has to go to whatever launched `yarn dev` (the terminal), since macOS attributes Electron to it.

Windows' equivalent is administrator rights. When the app isn't elevated and the scan is of this computer's own disk (`admin_would_help`; a network drive is no different for an administrator), Access Denied is reported with kind `admin`, which the renderer folds into one issue with a "Restart as administrator" button. `Ob.restartAsAdmin(path)` → `src/main/elevation.ts` relaunches the app through UAC (`relaunchElevated` in `src/scanner/admin.rs`, ShellExecuteEx "runas") with `--scan=<path>` and quits on a yes. The new instance starts that scan, and its window opens on it (`?inspect=` on the renderer URL, read by `navigation.tsx`). Elevated, the scanner turns on SeBackupPrivilege, so it can list folders whose ACLs leave administrators out too. In dev, the elevated copy gets a fresh environment with no `ELECTRON_RENDERER_URL` (and electron-vite stops with the first Electron), so it loads `build/renderer`: run `yarn build` first.

What Windows keeps for itself on a whole disk isn't usage the user can clean up. After a scan of a drive root, `src/scanner/reserved.rs` takes `pagefile.sys`, `swapfile.sys`, `hiberfil.sys`, and `System Volume Information` out of the tree (so they're in no list, search, or cleanup) and hands them back as the summary's `reserved`. `assembleRenderTree` puts them on the root's `RenderTree.reserved`; the legend lists them, grouped as "virtual memory", "hibernation", and "system restore" (`views/inspect/reserved.ts`), between the files and free space, and the sunburst draws them in gray in the innermost ring, like macOS's purgeable space.

Cancellation is cooperative: `cancelScan(path)` calls the native `scan.abort()` which sets an atomic flag the recursion checks at directory boundaries. In-flight syscalls run to completion (Node's fs / Rust's std::fs don't accept abort signals), then the recursion unwinds.

### Renderer UI

`Application.tsx` switches between `<Menu/>` (drive picker) and `<Display/>` based on whether the inspected scan is complete and a render tree has loaded. `<Display/>` composes `<List/>` and `<Sunburst/>` and passes navigation callbacks down (no global dispatch). Styling is Tailwind v4 utilities inline on JSX; theme variables, the `darwin:` / `win32:` / `linux:` custom variants, and a single `.btn` component class live in `src/renderer/resources/app.css`. The about window uses its own `about.css` entry, and shows the platform's app icon (`about.ts`, from `build-resources/about/`); it has no preload, so main passes the platform in its URL. Tailwind is wired through `@tailwindcss/vite` in the renderer config.

The window has one title bar, the app's own (`TitleBar` in `Application.tsx`), and the OS window title is `document.title`, which follows where the user is ("Users — Local Disk — Observatory"). On macOS the traffic lights sit in it (`hiddenInset`). On Windows and Linux (`viewManager.ts`) the native bar is hidden and its buttons overlaid (`titleBarOverlay`): the bar is a drag region, it keeps clear of the buttons with `env(titlebar-area-x/width)` (a Linux desktop can put them at the left, so the menu starts at `titlebar-area-x` and the title is inset by it from both ends), and the overlay's colors follow the app's theme through `Ob.setTitleBarTheme`. With no native menu bar there, the TitleBar shows the application menu's top-level labels (`Ob.getAppMenu`) and pops each submenu up under its label (`Ob.popupAppMenu`); the accelerators work regardless.

Main → renderer "set inspecting" events still flow through `Ob.onSetInspecting`; right now only `bridge.ts:selectDirectory` uses it (so the user lands on the new scan after the dialog closes).

### Build outputs

`build/main/`, `build/preload/`, and `build/renderer/`, all from electron-vite (see `yarn build`). Type checking is separate: `yarn check.types` over the root `tsconfig.json`.

## Rust backend status

`src/scanner/` is a synchronous parallel scanner driven by `rayon`'s work-stealing pool — `read_dir` once per directory, then fan out per-entry `metadata` + recursion through a parallel iterator. No async, no tokio. The crate ships three artifacts:

- A library (`lib.rs`) — the scan algorithm
- A CLI binary (`main.rs` → `observatory-scan`) — for ad-hoc scans and benchmarking; emits JSON to stdout and timing/counts to stderr
- A napi-rs cdylib (`bindings.rs`, gated behind the `napi` cargo feature) — the .node file the Electron main process loads. Exposes a `Scan` class with `start()` (returns Promise of a summary), `progress()` (sync mid-scan snapshot), and `abort()`, plus queries over the tree it keeps afterwards: `size()`, `renderTree(cursor)`, `search(base, query)` (Promise), `remove(parts)`, and `release()`. `Scan.fromJson` wraps a pre-built tree (the dev fake disk). Alongside it, `volumes()` (`volumes.rs`) lists the disks and network shares there are to scan, as the OS's file manager would: on macOS the mount table (`getfsstat`) minus `nobrowse` mounts, with DiskArbitration for volume names and to drop disk images; on Linux `/proc/self/mountinfo` (device-backed, minus loop devices, plus SMB/NFS/sshfs), one row per filesystem however many subvolumes and bind mounts it has, without `/boot` and the EFI partition, with udev labels (an ostree system's `/` is listed as the startup disk, with `usagePath` pointing at `/sysroot`, since statfs of its composefs image says nothing about the disk; in a Flatpak, the host's mounts are read from under `/run/host/root` and listed by their path there, unless the sandbox has the same mount at the same place); on Windows the drive letters (`GetDriveTypeW`, volume labels, `WNetGetConnectionW` for mapped shares). Each volume also says whether it's the startup volume, external, or encrypted (macOS: DiskArbitration, with `/` taking its Data volume's encryption, since FileVault leaves the sealed system snapshot alone; Linux: sysfs, a dm-crypt mapping anywhere under the device and a USB bus in its path; Windows: `SystemDrive` and the storage bus type, BitLocker not yet), and a share's server and protocol are parsed out of its mount source. The home screen words these as "2 TB encrypted startup disk" or "Pecha – SMB network share" (`describeDrive` in `src/renderer/format.ts`). None of it contacts a file server. How full each one is comes from `statfs` (of `usagePath` if there is one) in `vfsManager.readVolumeUsage`, which keeps one call per path in flight, since a vanished server can leave the call hanging on a libuv thread. Async scan and search run on libuv's threadpool, so the JS main thread stays free for IPC

The repo root is a Cargo workspace with `src/scanner/` as its one member, so cargo runs from the root and builds into `target/` there (not `build/`, which is electron-vite's and goes into the asar whole). Commands:

- `cargo build --release` builds the CLI
- `cargo test` runs the library unit tests against a tmp directory — no hardcoded paths
- `cargo build --release --lib --features napi` builds the cdylib (use `yarn build.native` for the cross-platform copy/rename to `observatory_scan.node`)

The napi-rs cdylib loads in Electron without a separate rebuild dance — N-API is ABI-stable across Node versions, so the same .node file works in plain Node and Electron's runtime. Forge ships it via `asar.unpack: "**/*.node"` so `path.resolve(app.getAppPath(), "src/scanner/observatory_scan.node")` resolves correctly in both dev and packaged builds.
