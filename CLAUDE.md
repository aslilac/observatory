# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Observatory is a cross-platform Electron desktop app for visualizing disk usage (think DaisyDisk). The TypeScript app is the shipped product; `rust-backend/` is an in-progress experimental rewrite of the scanning engine — not currently wired into the Electron app.

## Common commands

Package manager: **yarn** (yarn.lock is the source of truth; no committed package-lock.json). Scripts in `package.json` invoke `npm run …` internally — that's fine, both yarn and npm honor those. **Future migration:** plan to switch to pnpm — better disk usage and stricter dependency resolution. Don't do it incrementally.

Node: see `.nvmrc` (currently 22 LTS). Electron bundles its own Node, so this only governs build-side tooling.

- `yarn` — install deps. After install, run `yarn configure` once to rebuild the native `drivelist` module against the Electron ABI.
- `yarn dev` — runs four watchers concurrently (`tsc` for main, `esbuild` for preload, `parcel` for renderer, `nodemon` to restart Electron). Renderer/preload changes hot-reload via their watchers; main-process changes trigger a 2s-debounced Electron restart (see `nodemon.json`).
- `yarn build` — three sequential builds: `build:main` (tsc → `build/main`), `build:preload` (esbuild bundle → `build/preload.js`), `build:renderer` (parcel → `build/renderer`).
- `yarn forge` — `build` + Electron Forge packager/maker. DMG (macOS), Squirrel (win32), and zip artifacts.
- `yarn type-check` — `tsc --noEmit` over the whole project (includes renderer).
- `yarn fmt` — Prettier write. (No lint step; `tsc --strict` covers what ESLint would have.) Tests have been removed pending a vitest rewrite.
- Rust backend: `cd rust-backend && cargo test` — only `v4_big_scan` is uncommented and it hardcodes `/Library/Source` (macOS path), so it will fail on other machines unless edited.

Note: the README mentions Parcel; commit `c5f7af5` is `Revert "Use Vite instead of Parcel"`, so Parcel is the current/intended bundler — don't reintroduce Vite without checking why it was reverted.

## Architecture

Main owns the truth; renderer is a view that asks for it. Communication is plain RPC + push events — no shared state, no synced store.

### Process layout

- **Main** (`src/main/`) — Node-side. Owns drive list and active scans (`vfsManager.ts`), filesystem scanning (`vfs.ts`), window management. Entry: `src/main/index.ts`.
- **Preload** (`src/preload/index.ts`) — exposes the typed `Ob.*` surface to the renderer via `contextBridge`. Each method is a thin wrapper over `ipcRenderer.invoke` (RPC) or `ipcRenderer.on` (push events).
- **Renderer** (`src/renderer/`) — React 18 UI. Entry: `main.tsx` mounting `<Application/>`. UI state is local React state; cross-process data comes from custom hooks in `src/renderer/state.ts`.

### The Ob surface (declared in `src/@types/Observatory.d.ts`)

RPC: `selectDirectory`, `scanPath`, `getDrives`, `getScans`, `getRenderTree(path, cursor)`, `sizeToDisplay`, `sizeToMenu`. Subscriptions (each returns an unsubscribe): `onDrives`, `onScans`, `onSetInspecting`. The `onDrives` / `onScans` subscriptions also fire once with the current state immediately after subscribing, so renderer hooks don't need a separate initial fetch.

### State ownership

- **Main**: `vfsManager.ts` holds two `Map`s — `drives` (polled every 5s via `drivelist`) and `scans` (`{ status, vfs }` per path). It exposes pure getters (`getDrives`, `getScans`, `getRenderTree`) and a `startScan(path)` mutator. Changes are emitted through a Node `EventEmitter`; `bridge.ts` subscribes and re-broadcasts to all `webContents.send(...)`. The touchbar (`system/touchbar.ts`) also subscribes and rebuilds itself on change.
- **Renderer**: `Application.tsx` keeps `inspecting: string | null` and `cursor: string[]` in `useState`. `useDrives()` / `useScans()` hooks subscribe to the corresponding push events. `useRenderTree(path, cursor, status)` calls `Ob.getRenderTree` whenever path/cursor/status changes and the scan is `complete`.

### Scanning flow

1. User clicks Scan → `Ob.scanPath(path)` → `vfsManager.startScan(path)`.
2. `startScan` constructs a `VirtualFileSystem` (begins scanning in constructor), inserts `{ status: "building", vfs }` into the `scans` map, emits `scans` change → broadcast.
3. When the recursive `_scan` finishes, `VirtualFileSystem` invokes its registered `onComplete` callbacks. `vfsManager` flips status to `complete` and emits again.
4. The renderer sees the status flip via `useScans`, refetches the render tree via `Ob.getRenderTree(path, cursor)`.

`getRenderTree` produces a serialization-cheap subset of the full tree: directories smaller than 0.3% of the parent are dropped from the sunburst, and recursion is capped at depth 6. The renderer never sees the full VFS — only render trees.

`_scan` skips `/proc` on Linux and `/Volumes`, `/System/Volumes`, `*/Templates/Data/*` on macOS to avoid recursive mounts. Symlinks, character/block devices, and unknowns are counted but not added to the tree.

### Renderer UI

`Application.tsx` switches between `<Menu/>` (drive picker) and `<Display/>` based on whether the inspected scan is complete and a render tree has loaded. `<Display/>` composes `<List/>` and `<Sunburst/>` and passes navigation callbacks down (no global dispatch). Styling is Tailwind v4 utilities inline on JSX; theme variables, the `darwin:` / `win32:` / `linux:` custom variants, and a single `.btn` component class live in `src/renderer/resources/app.css`. The about window uses its own `about.css` entry. PostCSS config (`@tailwindcss/postcss`) lives in `.postcssrc`.

The touchbar (macOS only) drives the renderer's `inspecting` state by sending an `ob:setInspecting` event; the renderer subscribes via `Ob.onSetInspecting`.

### Native dependency

`drivelist` is a native module — after `yarn install` you must run `yarn configure` (= `electron-rebuild -f -w drivelist`) or Electron will fail to load it.

### Build outputs

`build/main/` (tsc), `build/preload.js` (esbuild bundle), `build/renderer/` (parcel). `tsconfig.build.json` excludes preload and renderer because they have their own bundlers; use the root `tsconfig.json` (and `yarn type-check`) for whole-project type checking.

## Rust backend status

`rust-backend/` contains four scan implementations (`v1.rs` through `v4.rs`, plus `v10.rs`) exploring sync vs. tokio approaches. Only `v4` is exercised by the test suite and only `v4` is exported in `lib.rs`. There is no FFI/N-API binding yet — this code does not run inside the Electron app.
