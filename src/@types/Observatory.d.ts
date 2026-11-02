declare global {
	namespace Ob {
		const PERF: string | undefined;
		const platform: "darwin" | "linux" | "win32";

		// RPC (renderer -> main)
		function selectDirectory(): Promise<string | undefined>;
		function scanPath(path: string): Promise<void>;
		function cancelScan(path: string): Promise<void>;
		// Replaces a finished or failed scan with a fresh one. Unlike scanPath,
		// which leaves a path that's already scanned alone.
		function rescanPath(path: string): Promise<void>;
		function getDrives(): Promise<PhysicalDrive[]>;
		function getScans(): Promise<ScanInfo[]>;
		function getRenderTree(
			path: string,
			cursor: string[],
		): Promise<RenderTree | null>;
		function getScanProgress(path: string): Promise<ScanProgress | null>;
		function getScanPerfTree(path: string): Promise<PerfNode | null>;
		function deleteFiles(
			paths: string[],
			mode: DeleteMode,
		): Promise<DeleteResult>;
		// Everything below the folder at `cursor` in a finished scan that
		// `query` matches, largest first. Null if there's no such folder.
		function findInScan(
			path: string,
			cursor: string[],
			query: FindQuery,
		): Promise<Found | null>;
		// How much each finder finds below the folder at `cursor`.
		function summarizeFinders(
			path: string,
			cursor: string[],
		): Promise<FinderSummary[] | null>;
		function getScanErrors(path: string): Promise<ScanError[]>;
		function statPath(path: string): Promise<PathStat | null>;
		function pathForFile(file: File): string;
		function publishRecentScans(
			recents: ReadonlyArray<{ path: string; scannedAt: number }>,
		): Promise<void>;
		function revealInFinder(path: string): Promise<void>;
		function openPath(path: string): Promise<string>;
		// macOS: opens Privacy & Security → Full Disk Access in System
		// Settings.
		function openFullDiskAccessSettings(): Promise<void>;
		// macOS: whether the app has Full Disk Access. True everywhere else,
		// where there's no such thing to grant.
		function hasFullDiskAccess(): Promise<boolean>;
		// Windows: starts the app again as an administrator, straight into a
		// scan of `path`, once the user says yes when Windows asks; then this
		// copy quits. Resolves false if they said no.
		function restartAsAdmin(path: string): Promise<boolean>;
		// Windows and Linux: the window's title bar draws its own window
		// controls (see viewManager.ts), which follow the app's theme rather
		// than the OS's.
		function setTitleBarTheme(theme: "light" | "dark"): Promise<void>;
		// Windows and Linux: runs the application menu's item `id` (from
		// onAppMenu), as a click on it in a native menu bar would.
		function clickAppMenuItem(id: string): Promise<void>;
		// A new version of the app, if there's one out (see
		// src/main/updates.ts).
		function getUpdate(): Promise<Update | null>;
		// Restarts into the update, once it's downloaded, or opens the new
		// version's release page, where the app can't update itself.
		function applyUpdate(): Promise<void>;
		// Dev-only. Resolves to the synthetic scan path so the renderer can
		// onOpen() it; rejects in packaged builds where the handler isn't
		// registered.
		function devLoadFakeDisk(): Promise<string>;

		// Push events (main -> renderer); each returns an unsubscribe.
		function onDrives(cb: (drives: PhysicalDrive[]) => void): () => void;
		function onScans(cb: (scans: ScanInfo[]) => void): () => void;
		function onUpdate(cb: (update: Update | null) => void): () => void;
		// Windows and Linux: the application menu, for the title bar to draw,
		// since the window has no menu bar. Again whenever it changes (Open
		// Recent).
		function onAppMenu(cb: (menu: AppMenu) => void): () => void;
		function onSetInspecting(cb: (path: string | null) => void): () => void;
		// The menu asking to scan a path and go to it (File → Open Folder…,
		// Open Recent).
		function onOpenScan(cb: (path: string) => void): () => void;
		function onNav(cb: (direction: "back" | "forward") => void): () => void;

		// The menus along the menu bar ("File", "Edit", …).
		export type AppMenu = Array<Extract<AppMenuItem, { kind: "submenu" }>>;
		export type AppMenuItem =
			| { kind: "separator" }
			| {
					kind: "item";
					id: string; // for clickAppMenuItem
					label: string;
					sublabel?: string;
					enabled: boolean;
					checked?: boolean; // a checkbox or radio item
					accelerator?: string; // "Ctrl+O"
			  }
			| {
					kind: "submenu";
					label: string;
					enabled: boolean;
					items: AppMenuItem[];
			  };

		// Downloaded, to be installed on the next start, or only out, to be
		// downloaded from its release page.
		export type Update =
			| { status: "downloaded" }
			| { status: "available"; version: string };

		export interface PhysicalDrive {
			mountPath: string;
			description: string;
			// A share mounted from another machine (SMB, NFS, …) rather than
			// a disk attached to this one.
			network: boolean;
			// The volume the OS started up from.
			startup: boolean;
			// On a disk that's plugged in (USB, an SD card) rather than built
			// in.
			external: boolean;
			// Encrypted at rest (FileVault, LUKS). Always false on Windows.
			encrypted: boolean;
			// For a share: the machine it's from ("Pecha") and what it's
			// shared over ("SMB"), when the OS says.
			server?: string;
			protocol?: string;
			// OS-reported space (statfs). Absent if the volume couldn't be
			// queried.
			usage?: DriveUsage;
		}

		// Bytes. `used + available` can fall short of `total`: some
		// filesystems hold back blocks that only root can write to.
		export interface DriveUsage {
			total: number;
			used: number;
			available: number;
		}

		// "failed" means the root itself couldn't be scanned (missing,
		// unreadable, …) — there's no tree to show, only `error`.
		export type ScanStatus = "building" | "complete" | "failed";

		export interface ScanInfo {
			path: string;
			status: ScanStatus;
			// Only set once the scan has completed.
			size?: number;
			// Only set when status is "failed".
			error?: ScanError;
			// Bumped whenever the VFS for this scan is mutated (e.g. after
			// trash). Lets the renderer key its render-tree fetch on it.
			revision: number;
		}

		// Gone for good, or into the system Trash.
		export type DeleteMode = "delete" | "trash";

		export interface DeleteResult {
			deleted: string[];
			failed: Array<{ path: string; error: string }>;
		}

		// Kinds of things that tend to be worth cleaning up, each found
		// across a whole folder (src/scanner/find.rs).
		export type Finder =
			| "large"
			| "old"
			| "videos"
			| "archives"
			| "installers"
			| "developer"
			| "caches";

		// Names that contain some text, ignoring case, or what a finder finds.
		export type FindQuery = { name: string } | { finder: Finder };

		export interface FindMatch {
			path: string;
			// The folders between the one searched and the match.
			within: string[];
			size: number;
			type: "file" | "directory";
			// When anything in it last changed, in milliseconds since 1970.
			// 0 if that isn't known.
			modified: number;
		}

		// Only the outermost match counts: a folder that matches, and not
		// what's in it too.
		export interface Found {
			// The largest 500, largest first.
			matches: FindMatch[];
			totalCount: number;
			totalSize: number;
			truncated: boolean;
		}

		export interface FinderSummary {
			finder: Finder;
			count: number;
			size: number;
		}

		export interface ScanError {
			path: string;
			// "protected": macOS privacy protection, which Full Disk Access
			// lifts. Reported only while the app doesn't have it.
			// "admin": Windows kept the scan out of a folder on this computer's
			// own disk, which an administrator could list. Reported only while
			// the app isn't one.
			kind: "permission" | "protected" | "admin" | "missing" | "loop" | "other";
			code: string | null;
			message: string;
		}

		export interface PathStat {
			exists: boolean;
			isDirectory: boolean;
			// Usage of the volume the path lives on, when it exists.
			volume?: DriveUsage;
		}

		export interface ScanProgress {
			path: string;
			status: ScanStatus;
			counts: {
				files: number;
				directories: number;
				symlinks: number;
				devices: number;
				misc: number;
			};
			currentPath: string | null;
			// Filtered, depth-capped snapshot of the perf tree. Only populated
			// when the main process is running with OB_PERF=1.
			perfTree?: PerfNode | null;
		}

		export interface PerfNode {
			name: string;
			path: string;
			// Wall time of the recursive _scan for this directory, including
			// all descendants. 0 while inProgress; use elapsedMs for the
			// running estimate in that case.
			totalMs: number;
			// performance.now() at snapshot time minus the _scan start. Equal
			// to totalMs once settled. Lets the renderer give in-progress
			// nodes a non-zero width.
			elapsedMs: number;
			// totalMs minus the slowest immediate child's totalMs. Approximates
			// "what would this _scan have cost if its children were free?" —
			// useful for spotting individual heavy directories rather than
			// just-large subtrees. 0 while inProgress.
			selfMs: number;
			// Time spent in the readdir() call alone.
			readdirMs: number;
			// Number of immediate entries (files + dirs + other).
			entryCount: number;
			// 0 = scan root.
			depth: number;
			inProgress: boolean;
			children: PerfNode[];
		}

		export type NodeType =
			| "directory"
			| "file"
			| "symlink"
			| "device"
			| "unknown";
		// "imaginary": the rest of a folder, too small to draw one by one.
		// "reserved": what Windows keeps for itself (ReservedSpace).
		export type NodeType$ = NodeType | "imaginary" | "reserved";

		export type VfsNode = VfsDirectory | VfsFile;

		export type VfsDirectory = {
			type: "directory";
			name: string;
			size: number;
			capacity?: number; // for drives
			// Latest mtime among this directory and all its descendants (epoch
			// ms). Useful for "what's been touched recently" sorting.
			mtime: number;
			files: VfsNode[];
		};

		export type VfsFile = {
			type: "file";
			name: string;
			size: number;
			mtime: number;
		};

		export type DisplayInfo = {
			files: VfsNode[];
		};

		// Space Windows keeps for itself at the root of a disk: virtual memory
		// (pagefile.sys, swapfile.sys), hibernation (hiberfil.sys), and System
		// Restore (System Volume Information). Not the user's to delete, so
		// it's counted apart from the tree, like macOS's purgeable space.
		export interface ReservedSpace {
			kind: "paging" | "hibernation" | "restore";
			name: string;
			size: number;
		}

		export type RenderTree = {
			name: string;
			cursor: string[];
			type: NodeType;
			rootCapacity: number;
			rootSize: number;
			capacity: number;
			position: number;
			size: number;
			list: DisplayInfo;
			sunburst: DisplayInfo;
			// Full recursive directory listing for the tree view: every child
			// of every descendant up to a fixed depth, alphabetically sorted at
			// each level. Unlike `sunburst.files` it isn't filtered by size, so
			// the tree shows tiny entries the sunburst would drop.
			tree: DisplayInfo;
			// At the root of a scan of a whole Windows disk, what Windows keeps
			// for itself, which isn't in `size`. Empty anywhere else.
			reserved: ReservedSpace[];
		};
	}
}

export {};
