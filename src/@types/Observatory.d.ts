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
		function deleteFiles(paths: string[]): Promise<DeleteResult>;
		function searchScan(
			path: string,
			query: string,
		): Promise<SearchResults | null>;
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
		// Windows: starts the app again as an administrator, straight into a
		// scan of `path`, once the user says yes when Windows asks; then this
		// copy quits. Resolves false if they said no.
		function restartAsAdmin(path: string): Promise<boolean>;
		// Windows and Linux: the window's title bar draws its own window
		// controls (see viewManager.ts), which follow the app's theme rather
		// than the OS's.
		function setTitleBarTheme(theme: "light" | "dark"): Promise<void>;
		// Windows and Linux: the application menu's top-level labels ("File",
		// "Edit", …), for the title bar to draw, since the window has no menu
		// bar.
		function getAppMenu(): Promise<string[]>;
		// Opens the application menu's `index`th submenu at (x, y), in CSS
		// pixels from the window's top left.
		function popupAppMenu(index: number, x: number, y: number): Promise<void>;
		// Dev-only. Resolves to the synthetic scan path so the renderer can
		// onOpen() it; rejects in packaged builds where the handler isn't
		// registered.
		function devLoadFakeDisk(): Promise<string>;

		// Push events (main -> renderer); each returns an unsubscribe.
		function onDrives(cb: (drives: PhysicalDrive[]) => void): () => void;
		function onScans(cb: (scans: ScanInfo[]) => void): () => void;
		function onSetInspecting(cb: (path: string | null) => void): () => void;
		function onNav(cb: (direction: "back" | "forward") => void): () => void;

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

		export interface DeleteResult {
			deleted: string[];
			failed: Array<{ path: string; error: string }>;
		}

		export interface SearchMatch {
			path: string;
			size: number;
			type: "file" | "directory";
		}

		export interface SearchResults {
			matches: SearchMatch[];
			totalCount: number;
			totalSize: number;
			truncated: boolean;
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
