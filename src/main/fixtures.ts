// Hand-built VFS tree used by the dev-only "Load fake disk" button on the
// Welcome screen. Sidesteps the multi-minute wait to scan a real disk by
// inserting a ready-made root straight into vfsManager.

const KB = 1000;
const MB = 1000 * KB;
const GB = 1000 * MB;

const DAY = 24 * 60 * 60 * 1000;

function file(name: string, size: number, ageDays: number): Ob.VfsFile {
	return {
		type: "file",
		name,
		// Whole bytes: 1.4 * GB isn't quite, and the scanner only takes integers.
		size: Math.round(size),
		mtime: Date.now() - ageDays * DAY,
	};
}

// Bundle children into a directory, rolling up size and the latest mtime
// and sorting size-descending to match what the real scanner produces.
function dir(name: string, children: Ob.VfsNode[]): Ob.VfsDirectory {
	let size = 0;
	let mtime = 0;
	for (const c of children) {
		size += c.size;
		if (c.mtime > mtime) {
			mtime = c.mtime;
		}
	}
	const sorted = [...children].sort((a, b) => b.size - a.size);
	return { type: "directory", name, size, mtime, files: sorted };
}

function manyTinyFiles(prefix: string, count: number, perFile: number) {
	const out: Ob.VfsNode[] = [];
	for (let i = 0; i < count; i++) {
		out.push(file(`${prefix}-${i}.cache`, perFile + ((i * 7) % 53) * KB, 30));
	}
	return out;
}

export function buildFakeDisk(): Ob.VfsDirectory {
	const tree = dir("Demo Disk", [
		dir("Applications", [
			dir("Photoshop.app", [
				file("Photoshop", 1.4 * GB, 60),
				file("Resources.dat", 320 * MB, 60),
				file("Plug-ins.bundle", 180 * MB, 60),
				file("Frameworks.bundle", 240 * MB, 60),
			]),
			dir("Xcode.app", [
				file("Xcode", 12 * GB, 120),
				file("DeveloperTools.bundle", 4.2 * GB, 120),
				file("Simulators.dat", 2.8 * GB, 120),
			]),
			dir("Firefox.app", [
				file("firefox", 220 * MB, 5),
				file("omni.ja", 120 * MB, 5),
				file("xul.dylib", 60 * MB, 5),
			]),
			dir("Slack.app", [
				file("Slack", 280 * MB, 14),
				file("Electron Framework", 180 * MB, 14),
			]),
			dir("Notes.app", [file("Notes", 18 * MB, 90)]),
		]),
		dir("Users", [
			dir("demo", [
				dir("Downloads", [
					file("ubuntu-24.04-desktop-amd64.iso", 5.2 * GB, 2),
					file("dataset-q3.tar.zst", 3.1 * GB, 7),
					file("recording.mp4", 2.4 * GB, 1),
					file("backup.zip", 1.8 * GB, 30),
					file("invoice-2026-04.pdf", 380 * KB, 1),
					file("photo.jpg", 4.2 * MB, 1),
					file("notes.md", 6 * KB, 0),
				]),
				dir("Documents", [
					dir("Projects", [
						dir("observatory", [
							file("README.md", 6 * KB, 1),
							file("yarn.lock", 920 * KB, 3),
							dir("node_modules", manyTinyFiles("dep", 60, 32 * KB)),
							dir("src", [
								file("index.ts", 8 * KB, 0),
								file("vfs.ts", 14 * KB, 0),
								file("Application.tsx", 6 * KB, 0),
							]),
						]),
						dir("garden", [
							file("plans.md", 24 * KB, 14),
							file("photos.zip", 220 * MB, 14),
						]),
					]),
					file("taxes-2025.pdf", 4.8 * MB, 90),
					file("resume.pdf", 180 * KB, 200),
				]),
				dir("Pictures", [
					dir("2026", [
						file("IMG_0001.heic", 5.4 * MB, 30),
						file("IMG_0002.heic", 5.1 * MB, 30),
						file("IMG_0003.heic", 6.2 * MB, 29),
						file("IMG_0004.heic", 4.8 * MB, 29),
						file("IMG_0005.heic", 7.1 * MB, 28),
					]),
					dir("2025", [
						file("vacation.mov", 2.2 * GB, 365),
						file("birthday.mov", 1.4 * GB, 365),
					]),
				]),
				dir("Library", [
					dir("Caches", [
						dir("com.apple.Safari", manyTinyFiles("cache", 200, 48 * KB)),
						dir("Google", [
							dir("Chrome", manyTinyFiles("entry", 150, 96 * KB)),
						]),
					]),
					dir("Logs", manyTinyFiles("log", 80, 12 * KB)),
				]),
				file(".DS_Store", 8 * KB, 0),
			]),
		]),
		dir("System", [
			file("kernelcache", 88 * MB, 365),
			dir("Library", [
				file("PrivateFrameworks.dat", 1.2 * GB, 365),
				file("Frameworks.dat", 800 * MB, 365),
			]),
		]),
		dir("private", [
			dir("var", [
				dir("log", manyTinyFiles("system", 40, 24 * KB)),
				dir("db", [file("locate.database", 32 * MB, 7)]),
			]),
		]),
	]);

	// Pretend this is a 500 GB drive so the inspect view shows free capacity.
	tree.capacity = 256 * GB;
	return tree;
}
