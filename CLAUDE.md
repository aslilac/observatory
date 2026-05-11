# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Observatory is a cross-platform Electron desktop app for visualizing disk usage (think DaisyDisk). The TypeScript app is the shipped product; `rust-backend/` is an in-progress experimental rewrite of the scanning engine — not currently wired into the Electron app.

## Common commands

Package manager: **yarn** (yarn.lock is the source of truth; no committed package-lock.json). Scripts in `package.json` invoke `npm run …` internally — that's fine, both yarn and npm honor those. **Future migration:** plan to switch to pnpm — better disk usage and stricter dependency resolution. Don't do it incrementally.

Node: see `.nvmrc` (currently 22 LTS). Electron bundles its own Node, so this only governs build-side tooling.

- `yarn` — install deps. After install, run `yarn configure` once to rebuild the native `drivelist` module against the Electron ABI.
- `yarn dev` — `electron-vite dev`. Vite serves the renderer with HMR (typically `http://localhost:5173`); main + preload are bundled with esbuild and Electron auto-restarts on main-process changes. One process, one log stream.
- `yarn build` — `electron-vite build`. Bundles all three processes into `build/main/index.js`, `build/preload/index.js`, and `build/renderer/` (multi-entry: `index.html` + `about.html`).
- `yarn forge` — `build` + `electron-forge make`. DMG (macOS), Squirrel (win32), and zip artifacts.
- `yarn preview` — `electron-vite preview`. Runs the packaged build without rebuilding — useful to verify `file://` loading for the renderer.
- `yarn type-check` — `tsc --noEmit` over the whole project.
- `yarn test` — Vitest, single run. `yarn test:watch` for the watcher.
- `yarn fmt` — Prettier write. (No lint step; `tsc --strict` covers what ESLint would have.)
- Rust backend: `cd rust-backend && cargo test` — only `v4_big_scan` is uncommented and it hardcodes `/Library/Source` (macOS path), so it will fail on other machines unless edited.

Build config lives in `electron.vite.config.ts` at the root — one file for all three processes. Renderer uses `@vitejs/plugin-react` and `@tailwindcss/vite` (Tailwind v4); main and preload use `externalizeDepsPlugin()` so runtime `dependencies` (notably the native `drivelist`) stay external.

In dev, the main process reads `process.env.ELECTRON_RENDERER_URL` and loads from it; in packaged builds it falls back to `loadFile("../renderer/index.html")`. Same pattern for the about window.

## Architecture

Main owns the truth; renderer is a view that asks for it. Communication is plain RPC + push events — no shared state, no synced store.

### Process layout

- **Main** (`src/main/`) — Node-side. Owns drive list and active scans (`vfsManager.ts`), filesystem scanning (`vfs.ts`), window management. Entry: `src/main/index.ts`.
- **Preload** (`src/preload/index.ts`) — exposes the typed `Ob.*` surface to the renderer via `contextBridge`. Each method is a thin wrapper over `ipcRenderer.invoke` (RPC) or `ipcRenderer.on` (push events).
- **Renderer** (`src/renderer/`) — React 18 UI. Entry: `main.tsx` mounting `<Application/>`. UI state is local React state; cross-process data comes from custom hooks in `src/renderer/state.ts`.

### The Ob surface (declared in `src/@types/Observatory.d.ts`)

RPC: `selectDirectory`, `scanPath`, `getDrives`, `getScans`, `getRenderTree(path, cursor)`. Subscriptions (each returns an unsubscribe): `onDrives`, `onScans`, `onSetInspecting`. The `onDrives` / `onScans` subscriptions also fire once with the current state immediately after subscribing, so renderer hooks don't need a separate initial fetch.

### State ownership

- **Main**: `vfsManager.ts` holds two `Map`s — `drives` (polled every 5s via `drivelist`) and `scans` (`{ status, vfs }` per path). It exposes pure getters (`getDrives`, `getScans`, `getRenderTree`) and a `startScan(path)` mutator. Changes are emitted through a Node `EventEmitter`; `bridge.ts` subscribes and re-broadcasts to all `webContents.send(...)`.
- **Renderer**: `Application.tsx` keeps `inspecting: string | null` and `cursor: string[]` in `useState`. `useDrives()` / `useScans()` hooks subscribe to the corresponding push events. `useRenderTree(path, cursor, status)` calls `Ob.getRenderTree` whenever path/cursor/status changes and the scan is `complete`.

### Scanning flow

1. User clicks Scan → `Ob.scanPath(path)` → `vfsManager.startScan(path)`.
2. `startScan` constructs a `VirtualFileSystem` (begins scanning in constructor), inserts `{ status: "building", vfs }` into the `scans` map, emits `scans` change → broadcast.
3. When the recursive `_scan` finishes, `VirtualFileSystem` invokes its registered `onComplete` callbacks. `vfsManager` flips status to `complete` and emits again.
4. The renderer sees the status flip via `useScans`, refetches the render tree via `Ob.getRenderTree(path, cursor)`.

`getRenderTree` produces a serialization-cheap subset of the full tree: directories smaller than 0.3% of the parent are dropped from the sunburst, and recursion is capped at depth 6. The renderer never sees the full VFS — only render trees.

`_scan` skips `/proc` on Linux and `/Volumes`, `/System/Volumes`, `*/Templates/Data/*` on macOS to avoid recursive mounts. Symlinks, character/block devices, and unknowns are counted but not added to the tree.

### Renderer UI

`Application.tsx` switches between `<Menu/>` (drive picker) and `<Display/>` based on whether the inspected scan is complete and a render tree has loaded. `<Display/>` composes `<List/>` and `<Sunburst/>` and passes navigation callbacks down (no global dispatch). Styling is Tailwind v4 utilities inline on JSX; theme variables, the `darwin:` / `win32:` / `linux:` custom variants, and a single `.btn` component class live in `src/renderer/resources/app.css`. The about window uses its own `about.css` entry. Tailwind is wired through `@tailwindcss/vite` in the renderer config.

Main → renderer "set inspecting" events still flow through `Ob.onSetInspecting`; right now only `bridge.ts:selectDirectory` uses it (so the user lands on the new scan after the dialog closes).

### Native dependency

`drivelist` is a native module — after `yarn install` you must run `yarn configure` (= `electron-rebuild -f -w drivelist`) or Electron will fail to load it.

### Build outputs

`build/main/` (tsc), `build/preload.js` (esbuild bundle), `build/renderer/` (parcel). `tsconfig.build.json` excludes preload and renderer because they have their own bundlers; use the root `tsconfig.json` (and `yarn type-check`) for whole-project type checking.

## Rust backend status

`rust-backend/` is a synchronous parallel scanner driven by `rayon`'s work-stealing pool — `read_dir` once per directory, then fan out per-entry `metadata` + recursion through a parallel iterator. No async, no tokio. The crate ships a library (`lib.rs`) and a CLI binary (`main.rs` → `observatory-scan`) that emits the `Ob.VfsDirectory`-shaped JSON to stdout and timing/counts to stderr.

- `cd rust-backend && cargo build --release` → `rust-backend/build/release/observatory-scan`. Build output lives under `rust-backend/build/` per `.cargo/config.toml`.
- `cd rust-backend && cargo test` runs the four unit tests in `lib.rs` against a tmp directory — no hardcoded paths.
- `node rust-backend/bench-js.mjs <path>` is a standalone Node re-implementation of the JS scanner's algorithm (without the drivelist/perf deps) used purely for apples-to-apples timing comparisons against the Rust CLI.

Not yet wired into the Electron app — no napi-rs binding or child-process bridge yet. The intended next step is to land the JS-scan-in-a-worker-thread refactor on the host side, then swap the worker's innards for `observatory-scan` (subprocess + JSON, or eventually napi-rs).
