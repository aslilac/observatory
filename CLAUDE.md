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
- `yarn test` — Jest via ts-jest. Single test: `yarn test path/to/file.test.ts` or `yarn test -t "test name"`. Currently only `src/main/vfs.test.ts` exists.
- `yarn type-check` — `tsc --noEmit` over the whole project (includes renderer).
- `yarn fmt` — Prettier write. (No lint step; `tsc --strict` covers what ESLint would have.)
- Rust backend: `cd rust-backend && cargo test` — only `v4_big_scan` is uncommented and it hardcodes `/Library/Source` (macOS path), so it will fail on other machines unless edited.

Note: the README mentions Parcel; commit `c5f7af5` is `Revert "Use Vite instead of Parcel"`, so Parcel is the current/intended bundler — don't reintroduce Vite without checking why it was reverted.

## Architecture

Three Electron processes share a single Redux store via `@mckayla/electron-redux`, which transparently syncs state across IPC. The store is the _primary_ communication channel — most "send a message to the other process" patterns are implemented as dispatched actions, not direct IPC calls.

### Process layout

- **Main** (`src/main/`) — Node-side. Owns filesystem scanning, drive enumeration, and window management. Entry: `src/main/index.ts`.
- **Preload** (`src/preload/index.ts`) — bridges renderer to a few imperative IPC handlers (directory picker, window resize). Exposes a `window.Ob` global typed by `src/@types/Observatory.d.ts`.
- **Renderer** (`src/renderer/`) — React 18 + react-redux UI. Entry: `main.tsx` mounting `<Application/>`.

### Store

`src/store/common.ts` is the shared reducer. `main.ts` and `renderer.ts` each create a store with the `syncMain`/`syncRenderer` enhancers — _do not_ create a store any other way; the enhancers are what keep main and renderer in sync. State shape: `drives`, `vfs` (Map of `path → VfsState`), `inspecting`. Action creators are annotated `@direction main -> renderer` / `renderer -> main` to document expected origin; the store sync handles propagation either way. The reducer uses Immer with `enableMapSet()` because state contains `Map`s.

### Scanning flow

`vfsManager.ts` subscribes to the store and acts as a state-machine driver:

1. Renderer dispatches `createVfs(path)` → state goes to `init`.
2. The subscriber sees `init`, constructs a `VirtualFileSystem` (which begins scanning in its constructor), dispatches `premountVfs` → `building`.
3. When `vfs.ts`'s recursive `_scan` finishes, it dispatches `mountVfs(path, tree)` → `complete`.
4. Navigation actions (`navigateUp`, `navigateForward`, `inspectVfsAtCursor`, etc.) update `cursor` and set `outOfDate: true`; the subscriber sees that and re-dispatches `render` with a fresh `getRenderTree(cursor)`.

`getRenderTree` produces a serialization-cheap subset of the full tree: directories smaller than 0.3% of the parent are dropped from the sunburst, and recursion is capped at depth 6. The renderer never sees the full VFS — only render trees.

`_scan` skips `/proc` on Linux and `/Volumes`, `/System/Volumes`, `*/Templates/Data/*` on macOS to avoid recursive mounts. Symlinks, character/block devices, and unknowns are counted but not added to the tree.

### Renderer UI

`Application.tsx` switches between `<Menu/>` (drive picker) and `<Display/>` based on whether `state.inspecting` resolves to a `complete` VFS. `<Display/>` composes `<List/>` and `<Sunburst/>`. SCSS lives in `src/renderer/resources/`.

### Native dependency

`drivelist` is a native module — after `npm install` you must run `yarn configure` (= `electron-rebuild -f -w drivelist`) or Electron will fail to load it.

### Build outputs

`build/main/` (tsc), `build/preload.js` (esbuild bundle), `build/renderer/` (parcel). `tsconfig.build.json` excludes preload and renderer because they have their own bundlers; use the root `tsconfig.json` (and `yarn type-check`) for whole-project type checking.

## Rust backend status

`rust-backend/` contains four scan implementations (`v1.rs` through `v4.rs`, plus `v10.rs`) exploring sync vs. tokio approaches. Only `v4` is exercised by the test suite and only `v4` is exported in `lib.rs`. There is no FFI/N-API binding yet — this code does not run inside the Electron app.
