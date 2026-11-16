// A hand-built disk, for trying the inspect view without the wait to scan a
// real one. It's made as the JSON the scanner reads trees from, and listed
// through `Scans::start_fake`.

use crate::format::now_ms;
use serde_json::{Value, json};

const KB: u64 = 1000;
const MB: u64 = 1000 * KB;
const GB: u64 = 1000 * MB;

const DAY: u64 = 24 * 60 * 60 * 1000;

/// What the made-up disk claims to hold, so there's free space to show.
pub const CAPACITY: u64 = 256 * GB;

struct Builder {
	now: u64,
}

impl Builder {
	fn file(&self, name: &str, size: u64, age_days: u64) -> Value {
		json!({
			"type": "file",
			"name": name,
			"size": size,
			"mtime": self.now.saturating_sub(age_days * DAY),
		})
	}

	fn many_tiny_files(&self, prefix: &str, count: u64, per_file: u64) -> Vec<Value> {
		(0..count)
			.map(|i| {
				self.file(
					&format!("{prefix}-{i}.cache"),
					per_file + ((i * 7) % 53) * KB,
					30,
				)
			})
			.collect()
	}
}

// Bundle children into a directory, rolling up size and the latest mtime
// and sorting size-descending to match what the real scanner produces.
fn dir(name: &str, mut children: Vec<Value>) -> Value {
	let size: u64 = children.iter().filter_map(|c| c["size"].as_u64()).sum();
	let mtime = children
		.iter()
		.filter_map(|c| c["mtime"].as_u64())
		.max()
		.unwrap_or(0);
	children.sort_by_key(|c| std::cmp::Reverse(c["size"].as_u64()));
	json!({ "type": "directory", "name": name, "size": size, "mtime": mtime, "files": children })
}

/// The disk, as JSON.
pub fn build() -> String {
	let b = Builder { now: now_ms() };
	let tenths = |n: u64, unit: u64| n * unit / 10;
	dir(
		"Demo Disk",
		vec![
			dir(
				"Applications",
				vec![
					dir(
						"Photoshop.app",
						vec![
							b.file("Photoshop", tenths(14, GB), 60),
							b.file("Resources.dat", 320 * MB, 60),
							b.file("Plug-ins.bundle", 180 * MB, 60),
							b.file("Frameworks.bundle", 240 * MB, 60),
						],
					),
					dir(
						"Xcode.app",
						vec![
							b.file("Xcode", 12 * GB, 120),
							b.file("DeveloperTools.bundle", tenths(42, GB), 120),
							b.file("Simulators.dat", tenths(28, GB), 120),
						],
					),
					dir(
						"Firefox.app",
						vec![
							b.file("firefox", 220 * MB, 5),
							b.file("omni.ja", 120 * MB, 5),
							b.file("xul.dylib", 60 * MB, 5),
						],
					),
					dir(
						"Slack.app",
						vec![
							b.file("Slack", 280 * MB, 14),
							b.file("Electron Framework", 180 * MB, 14),
						],
					),
					dir("Notes.app", vec![b.file("Notes", 18 * MB, 90)]),
				],
			),
			dir(
				"Users",
				vec![dir(
					"demo",
					vec![
						dir(
							"Downloads",
							vec![
								b.file("ubuntu-24.04-desktop-amd64.iso", tenths(52, GB), 2),
								b.file("dataset-q3.tar.zst", tenths(31, GB), 7),
								b.file("recording.mp4", tenths(24, GB), 1),
								b.file("backup.zip", tenths(18, GB), 30),
								b.file("invoice-2026-04.pdf", 380 * KB, 1),
								b.file("photo.jpg", tenths(42, MB), 1),
								b.file("notes.md", 6 * KB, 0),
							],
						),
						dir(
							"Documents",
							vec![
								dir(
									"Projects",
									vec![
										dir(
											"observatory",
											vec![
												b.file("README.md", 6 * KB, 1),
												b.file("pnpm-lock.yaml", 920 * KB, 3),
												dir(
													"node_modules",
													b.many_tiny_files("dep", 60, 32 * KB),
												),
												dir(
													"src",
													vec![
														b.file("index.ts", 8 * KB, 0),
														b.file("vfs.ts", 14 * KB, 0),
														b.file("Application.tsx", 6 * KB, 0),
													],
												),
											],
										),
										dir(
											"garden",
											vec![
												b.file("plans.md", 24 * KB, 14),
												b.file("photos.zip", 220 * MB, 14),
											],
										),
									],
								),
								b.file("taxes-2025.pdf", tenths(48, MB), 90),
								b.file("resume.pdf", 180 * KB, 200),
							],
						),
						dir(
							"Pictures",
							vec![
								dir(
									"2026",
									vec![
										b.file("IMG_0001.heic", tenths(54, MB), 30),
										b.file("IMG_0002.heic", tenths(51, MB), 30),
										b.file("IMG_0003.heic", tenths(62, MB), 29),
										b.file("IMG_0004.heic", tenths(48, MB), 29),
										b.file("IMG_0005.heic", tenths(71, MB), 28),
									],
								),
								dir(
									"2025",
									vec![
										b.file("vacation.mov", tenths(22, GB), 365),
										b.file("birthday.mov", tenths(14, GB), 365),
									],
								),
							],
						),
						dir(
							"Library",
							vec![
								dir(
									"Caches",
									vec![
										dir(
											"com.apple.Safari",
											b.many_tiny_files("cache", 200, 48 * KB),
										),
										dir(
											"Google",
											vec![dir(
												"Chrome",
												b.many_tiny_files("entry", 150, 96 * KB),
											)],
										),
									],
								),
								dir("Logs", b.many_tiny_files("log", 80, 12 * KB)),
							],
						),
						b.file(".DS_Store", 8 * KB, 0),
					],
				)],
			),
			dir(
				"System",
				vec![
					b.file("kernelcache", 88 * MB, 365),
					dir(
						"Library",
						vec![
							b.file("PrivateFrameworks.dat", tenths(12, GB), 365),
							b.file("Frameworks.dat", 800 * MB, 365),
						],
					),
				],
			),
			dir(
				"private",
				vec![dir(
					"var",
					vec![
						dir("log", b.many_tiny_files("system", 40, 24 * KB)),
						dir("db", vec![b.file("locate.database", 32 * MB, 7)]),
					],
				)],
			),
		],
	)
	.to_string()
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::scans::Scans;

	#[test]
	fn the_fake_disk_loads() {
		let scans = Scans::new(|_| {});
		let path = scans.start_fake("demo", &build(), Some(CAPACITY)).unwrap();
		let root = scans.render_tree(&path, &[]).unwrap();
		assert_eq!(root.name, "Demo Disk");
		assert_eq!(root.capacity, CAPACITY);
		// Largest first, as the scanner has them.
		assert_eq!(root.list[0].name, "Applications");
		assert!(root.size > 40 * GB && root.size < CAPACITY);
	}
}
