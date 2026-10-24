// The Linux mount table (/proc/self/mountinfo), and what a scan of a whole
// disk and the list of disks make of it.
//
// A disk on Linux is rarely one mount. btrfs mounts subvolumes of one
// filesystem in several places (Fedora puts /home in one, Bazzite /var as
// well), and stat gives each subvolume a device number of its own, so st_dev
// can't tell they're one disk. Bind mounts show a folder in a second place:
// an ostree system's /etc is a folder of its deployment, which is under
// /sysroot too. And an ostree system with composefs boots from a read-only
// image at /, whose files are the deployment's again. The mount table says
// which filesystem each mount is and which folder of it, which is what it
// takes to go into every subvolume once and count each folder in one place.

use crate::volumes::unescape;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct Mount {
	/// The device number, `major:minor`.
	pub dev: String,
	/// The folder of the filesystem mounted here: `/` for the whole of it,
	/// a subvolume (`/home`), or the folder a bind mount shows.
	pub root: String,
	/// Where it's mounted.
	pub path: String,
	pub fs_type: String,
	/// What was mounted: a device node, a share (`//nas/media`), or a
	/// placeholder (`tmpfs`, `composefs`).
	pub source: String,
}

impl Mount {
	/// Mounted from a device node: a partition, an LVM or LUKS volume.
	pub fn on_device(&self) -> bool {
		self.source.starts_with("/dev/")
	}

	/// Which filesystem this is a mount of. Those on a device go by the
	/// device node, which every subvolume of a btrfs filesystem shares, and
	/// the rest by device number, since `tmpfs` says nothing.
	pub fn filesystem(&self) -> &str {
		if self.on_device() {
			&self.source
		} else {
			&self.dev
		}
	}
}

// Each line goes `id parent major:minor root path options [tags…] - type
// source super-options`, with whitespace and backslashes in a field
// octal-escaped (`\040`).
pub fn parse(table: &str) -> Vec<Mount> {
	table
		.lines()
		.filter_map(|line| {
			let mut fields = line.split(' ');
			let dev = fields.nth(2)?.to_owned();
			let root = unescape(fields.next()?, "\\", 3, 8);
			let path = unescape(fields.next()?, "\\", 3, 8);
			let mut fields = fields.skip_while(|field| *field != "-").skip(1);
			Some(Mount {
				dev,
				root,
				path,
				fs_type: fields.next()?.to_owned(),
				source: unescape(fields.next()?, "\\", 3, 8),
			})
		})
		.collect()
}

// The mounts that can be seen: of several at one place, the last mounted.
pub fn visible(mounts: &[Mount]) -> Vec<&Mount> {
	let top: HashMap<&str, usize> = mounts
		.iter()
		.enumerate()
		.map(|(i, mount)| (mount.path.as_str(), i))
		.collect();
	mounts
		.iter()
		.enumerate()
		.filter(|(i, mount)| top[mount.path.as_str()] == *i)
		.map(|(_, mount)| mount)
		.collect()
}

// For a system mounted at `image.path` (`/`, or the host's, seen from a
// sandbox), the mount of the disk it's on, when `image` is an ostree boot
// image rather than a disk: the one at /sysroot, by ostree's convention.
pub fn ostree_sysroot<'a>(mounts: &[&'a Mount], image: &Mount) -> Option<&'a Mount> {
	if image.on_device() {
		return None;
	}
	let sysroot = join(&image.path, "sysroot");
	mounts
		.iter()
		.copied()
		.find(|mount| mount.path == sysroot && mount.on_device())
}

pub struct Plan {
	/// Places below the scan's root to go into or leave out, where the
	/// walk would otherwise go on: mount points, and folders that a mount
	/// shows somewhere better. Mounts of other filesystems are left out.
	pub enter: HashMap<String, bool>,
	/// Whether what's in the root folder counts, rather than only the
	/// mounts in it: not for an ostree boot image.
	pub root_counts: bool,
}

// One place a folder of the disk shows up: `root` (of the filesystem) at
// `path`.
struct View {
	root: String,
	path: String,
}

// Where a scan of `root` (a real path) goes in the mount table: into every
// mount of its own disk it can get to, and of the places one folder shows
// up in, only into the shallowest, or where it already was on a tie. So
// /etc counts at /etc, not deep in the ostree deployment it's from. A mount
// whose folder is the one already there (ostree mounts its var on itself)
// just goes in.
pub fn plan(mounts: &[Mount], root: &str) -> Option<Plan> {
	let mounts = visible(mounts);
	let home = mounts
		.iter()
		.copied()
		.filter(|mount| below(root, &mount.path).is_some())
		.max_by_key(|mount| mount.path.len())?;
	let sysroot = (home.path == root)
		.then(|| ostree_sysroot(&mounts, home))
		.flatten();
	let disk = sysroot.unwrap_or(home).filesystem();
	let inside: Vec<&Mount> = mounts
		.iter()
		.copied()
		.filter(|mount| below(&mount.path, root).is_some_and(|rest| !rest.is_empty()))
		.collect();
	// Whether the walk sees `view`'s own filesystem at `place`, rather
	// than another mount on top of it there or on the way.
	let shows = |view: &View, place: &str| {
		!inside.iter().any(|mount| {
			below(&mount.path, &view.path).is_some_and(|rest| !rest.is_empty())
				&& below(place, &mount.path).is_some()
		})
	};

	let mut enter = HashMap::new();
	let mut views = Vec::new();
	for &mount in &inside {
		if mount.filesystem() != disk {
			enter.insert(mount.path.clone(), false);
		} else if inside
			.iter()
			.all(|other| other.filesystem() == disk || below(&mount.path, &other.path).is_none())
		{
			views.push(View {
				root: mount.root.clone(),
				path: mount.path.clone(),
			});
		}
	}
	views.sort_by(|a, b| rank(a).cmp(&rank(b)));

	let mut entered = Vec::new();
	if sysroot.is_none() {
		entered.push(View {
			root: join(&home.root, below(root, &home.path)?),
			path: root.to_owned(),
		});
	}
	for view in views {
		// The other places the walk would come to this folder: in views
		// already going in, whose folder holds it.
		let elsewhere: Vec<String> = entered
			.iter()
			.filter_map(|other| {
				let place = join(&other.path, below(&view.root, &other.root)?);
				(place != view.path && shows(other, &place)).then_some(place)
			})
			.collect();
		if elsewhere
			.iter()
			.any(|place| depth(place) <= depth(&view.path))
		{
			enter.insert(view.path, false);
			continue;
		}
		for place in elsewhere {
			enter.insert(place, false);
		}
		// Folders already going in that show up again inside this one: the
		// system an older ostree mounts at / is a folder under /sysroot.
		for other in &entered {
			if let Some(rest) = below(&other.root, &view.root).filter(|rest| !rest.is_empty()) {
				let place = join(&view.path, rest);
				if shows(&view, &place) {
					enter.insert(place, false);
				}
			}
		}
		enter.insert(view.path.clone(), true);
		entered.push(view);
	}
	Some(Plan {
		enter,
		root_counts: sysroot.is_none(),
	})
}

// Views that show more of the disk first, then the shallower.
fn rank(view: &View) -> (usize, usize, &str) {
	(view.root.len(), depth(&view.path), &view.path)
}

// What's left of `path` below `dir`: "" for `dir` itself, None if it isn't
// inside it.
pub fn below<'a>(path: &'a str, dir: &str) -> Option<&'a str> {
	if dir == "/" {
		return path.strip_prefix('/');
	}
	match path.strip_prefix(dir)? {
		"" => Some(""),
		rest => rest.strip_prefix('/'),
	}
}

pub fn join(dir: &str, rest: &str) -> String {
	if rest.is_empty() {
		dir.to_owned()
	} else if dir.ends_with('/') {
		format!("{dir}{rest}")
	} else {
		format!("{dir}/{rest}")
	}
}

pub fn depth(path: &str) -> usize {
	path.split('/').filter(|part| !part.is_empty()).count()
}

#[cfg(test)]
pub(crate) mod tests {
	use super::*;

	const LUKS: &str = "/dev/mapper/luks-f348de8c-1c3b-4943-a512-b43f24237d7a";
	const DEPLOYMENT: &str = "/root/ostree/deploy/default/deploy/cdc30844da7a4f3f36e899afd21f310a4ba37c8932d592de9dcbd891e275bd7d.0";

	pub(crate) fn line(
		id: u32,
		dev: &str,
		root: &str,
		path: &str,
		fs_type: &str,
		source: &str,
	) -> String {
		format!("{id} 1 {dev} {root} {path} rw,relatime shared:{id} - {fs_type} {source} rw\n")
	}

	// Bazzite, as `findmnt --real` showed it on a real install, plus the
	// virtual filesystems every Linux has: a composefs image at /, and one
	// LUKS volume with btrfs subvolumes for /sysroot, /var and /var/home.
	pub(crate) fn bazzite(prefix: &str) -> String {
		let at = |path: &str| join(prefix, path.trim_start_matches('/'));
		[
			line(24, "0:22", "/", &at("/"), "overlay", "composefs"),
			line(25, "0:26", "/", &at("/sys"), "sysfs", "sysfs"),
			line(26, "0:6", "/", &at("/dev"), "devtmpfs", "devtmpfs"),
			line(27, "0:27", "/", &at("/proc"), "proc", "proc"),
			line(28, "0:28", "/", &at("/run"), "tmpfs", "tmpfs"),
			line(30, "0:35", "/root", &at("/sysroot"), "btrfs", LUKS),
			line(
				31,
				"0:35",
				&format!("{DEPLOYMENT}/etc"),
				&at("/etc"),
				"btrfs",
				LUKS,
			),
			line(
				32,
				"0:35",
				"/root/ostree/deploy/default/var",
				&at("/sysroot/ostree/deploy/default/var"),
				"btrfs",
				LUKS,
			),
			line(33, "0:35", "/var", &at("/var"), "btrfs", LUKS),
			line(34, "0:40", "/", &at("/tmp"), "tmpfs", "tmpfs"),
			line(60, "0:35", "/home", &at("/var/home"), "btrfs", LUKS),
			line(61, "259:2", "/", &at("/boot"), "ext4", "/dev/nvme0n1p2"),
			line(62, "259:1", "/", &at("/boot/efi"), "vfat", "/dev/nvme0n1p1"),
			line(
				70,
				"8:1",
				"/",
				&at("/run/media/kayla/STICK"),
				"exfat",
				"/dev/sda1",
			),
		]
		.concat()
	}

	// The same machine as a Flatpak sandbox sees it, with host-root: the
	// host's mounts under /run/host/root, and the sandbox's own (its /usr is
	// a runtime from the host's /var/lib/flatpak, home and removable disks
	// are where they are on the host).
	pub(crate) fn bazzite_sandbox() -> String {
		let runtime =
			"/var/lib/flatpak/runtime/org.freedesktop.Platform/x86_64/26.08/0123abcd/files";
		[
			line(1, "0:90", "/", "/", "tmpfs", "tmpfs"),
			line(2, "0:35", runtime, "/usr", "btrfs", LUKS),
			line(3, "0:35", "/home/kayla", "/var/home/kayla", "btrfs", LUKS),
			line(
				4,
				"8:1",
				"/",
				"/run/media/kayla/STICK",
				"exfat",
				"/dev/sda1",
			),
			line(5, "0:91", "/", "/proc", "proc", "proc"),
			bazzite("/run/host/root"),
		]
		.concat()
	}

	fn entered(plan: &Plan) -> Vec<(&str, bool)> {
		let mut places: Vec<(&str, bool)> = plan
			.enter
			.iter()
			.map(|(place, enter)| (place.as_str(), *enter))
			.collect();
		places.sort();
		places
	}

	#[test]
	fn parses_tags_and_escapes() {
		let mounts = parse(
			"36 35 98:0 /mnt1 /mnt/My\\040Disk rw,noatime master:1 shared:2 - ext3 /dev/root rw,errors=continue\n\
			 37 35 0:5 / /short rw\n",
		);
		assert_eq!(mounts.len(), 1);
		let mount = &mounts[0];
		assert_eq!(
			(
				mount.dev.as_str(),
				mount.root.as_str(),
				mount.path.as_str(),
				mount.fs_type.as_str(),
				mount.source.as_str()
			),
			("98:0", "/mnt1", "/mnt/My Disk", "ext3", "/dev/root")
		);
	}

	#[test]
	fn bazzite_counts_the_disk_once_and_not_the_boot_image() {
		let plan = plan(&parse(&bazzite("/")), "/").unwrap();
		assert!(!plan.root_counts);
		assert_eq!(
			entered(&plan),
			[
				("/boot", false),
				("/boot/efi", false),
				("/dev", false),
				("/etc", true),
				("/proc", false),
				("/run", false),
				("/run/media/kayla/STICK", false),
				("/sys", false),
				("/sysroot", true),
				// /etc counts at /etc, so not in the deployment as well.
				(&*format!("/sysroot{}/etc", &DEPLOYMENT[5..]), false),
				("/sysroot/ostree/deploy/default/var", true),
				("/tmp", false),
				("/var", true),
				("/var/home", true),
			]
		);
	}

	#[test]
	fn a_sandbox_scans_the_host_through_its_root() {
		let plan = plan(&parse(&bazzite_sandbox()), "/run/host/root").unwrap();
		assert!(!plan.root_counts);
		let going_in: Vec<&str> = entered(&plan)
			.into_iter()
			.filter_map(|(place, enter)| enter.then_some(place))
			.collect();
		assert_eq!(
			going_in,
			[
				"/run/host/root/etc",
				"/run/host/root/sysroot",
				"/run/host/root/sysroot/ostree/deploy/default/var",
				"/run/host/root/var",
				"/run/host/root/var/home",
			]
		);
	}

	#[test]
	fn a_folder_inside_a_subvolume_has_nothing_to_plan() {
		let plan = plan(&parse(&bazzite("/")), "/var/home/kayla").unwrap();
		assert!(plan.root_counts);
		assert!(plan.enter.is_empty());
	}

	// Fedora Workstation: / and /home are subvolumes of one btrfs
	// filesystem, so st_dev differs between them. And a folder bound to a
	// place as deep as its own counts where it is.
	#[test]
	fn follows_btrfs_subvolumes() {
		let table = [
			line(1, "0:32", "/root", "/", "btrfs", "/dev/nvme0n1p3"),
			line(2, "0:32", "/home", "/home", "btrfs", "/dev/nvme0n1p3"),
			line(3, "259:2", "/", "/boot", "ext4", "/dev/nvme0n1p2"),
			line(4, "0:5", "/", "/proc", "proc", "proc"),
			line(5, "0:32", "/root/srv", "/again", "btrfs", "/dev/nvme0n1p3"),
		]
		.concat();
		let plan = plan(&parse(&table), "/").unwrap();
		assert!(plan.root_counts);
		assert_eq!(
			entered(&plan),
			[
				("/again", false),
				("/boot", false),
				("/home", true),
				("/proc", false)
			]
		);
	}

	// Silverblue, without a subvolume for /var: /var is the stateroot's var
	// under /sysroot, which ostree also mounts on itself.
	#[test]
	fn a_bind_mount_counts_where_its_shallowest() {
		let var = "/root/ostree/deploy/fedora/var";
		let table = [
			line(1, "0:22", "/", "/", "overlay", "composefs"),
			line(2, "0:35", "/root", "/sysroot", "btrfs", "/dev/vda3"),
			line(
				3,
				"0:35",
				var,
				"/sysroot/ostree/deploy/fedora/var",
				"btrfs",
				"/dev/vda3",
			),
			line(4, "0:35", var, "/var", "btrfs", "/dev/vda3"),
			line(5, "0:35", "/home", "/var/home", "btrfs", "/dev/vda3"),
		]
		.concat();
		let plan = plan(&parse(&table), "/").unwrap();
		assert_eq!(
			entered(&plan),
			[
				("/sysroot", true),
				("/sysroot/ostree/deploy/fedora/var", false),
				("/var", true),
				("/var/home", true),
			]
		);
	}

	// Before composefs, ostree mounted the deployment itself at /.
	#[test]
	fn leaves_out_the_root_where_it_shows_up_again() {
		let deployment = "/root/ostree/deploy/fedora/deploy/abc.0";
		let table = [
			line(1, "0:35", deployment, "/", "btrfs", "/dev/vda3"),
			line(2, "0:35", "/root", "/sysroot", "btrfs", "/dev/vda3"),
		]
		.concat();
		let plan = plan(&parse(&table), "/").unwrap();
		assert!(plan.root_counts);
		assert_eq!(
			entered(&plan),
			[
				("/sysroot", true),
				("/sysroot/ostree/deploy/fedora/deploy/abc.0", false),
			]
		);
	}

	#[test]
	fn other_disks_inside_a_mount_of_another_are_out_of_reach() {
		let table = [
			line(1, "8:1", "/", "/", "ext4", "/dev/sda1"),
			line(2, "0:40", "/", "/mnt/nas", "cifs", "//nas/media"),
			line(3, "8:1", "/srv", "/mnt/nas/srv", "ext4", "/dev/sda1"),
		]
		.concat();
		let plan = plan(&parse(&table), "/").unwrap();
		assert_eq!(entered(&plan), [("/mnt/nas", false)]);
	}

	#[test]
	fn below_takes_whole_names() {
		assert_eq!(below("/var/home", "/var"), Some("home"));
		assert_eq!(below("/var", "/var"), Some(""));
		assert_eq!(below("/variable", "/var"), None);
		assert_eq!(below("/x/y", "/"), Some("x/y"));
		assert_eq!(join("/", "x"), "/x");
		assert_eq!(join("/a", ""), "/a");
		assert_eq!(depth("/"), 0);
		assert_eq!(depth("/a/b"), 2);
	}
}
