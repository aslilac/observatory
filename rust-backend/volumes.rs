// The volumes there are to scan, as the OS's own file manager would list
// them: disks attached to this machine, and shares mounted from others (SMB,
// NFS, …). The main process polls this for the home screen.
//
// Everything here comes from what the OS already knows (the mount table,
// disk descriptions, labels), and nothing asks a file server anything, so a
// share whose server has gone away still lists instantly. How full each
// volume is comes from statfs on the JS side.

#[cfg_attr(feature = "napi", napi_derive::napi(object))]
pub struct Volume {
	/// Where it's mounted: `/`, `/Volumes/Backup`, `C:\`.
	pub path: String,
	/// What to call it: "Macintosh HD", a disk's label, a share's name.
	pub name: String,
	/// Mounted from another machine, rather than a disk attached to this one.
	pub network: bool,
	/// The volume the OS started up from.
	pub startup: bool,
	/// On a disk that's plugged in (USB, an SD card) rather than built in.
	pub external: bool,
	/// Encrypted at rest (FileVault, LUKS). Always false on Windows for now:
	/// BitLocker's status only comes through COM.
	pub encrypted: bool,
	/// For a share, the machine it's mounted from ("Pecha"), when the mount
	/// table says.
	pub server: Option<String>,
	/// For a share, what it's shared over: "SMB", "NFS", ….
	pub protocol: Option<String>,
}

#[cfg(target_os = "macos")]
pub use macos::volumes;

#[cfg(target_os = "linux")]
pub use linux::volumes;

#[cfg(windows)]
pub use windows::volumes;

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn volumes() -> Vec<Volume> {
	Vec::new()
}

// What a share is shared over, by the filesystem it's mounted as. None for
// anything that isn't a network filesystem.
#[cfg_attr(windows, allow(dead_code))]
fn share_protocol(fs_type: &str) -> Option<&'static str> {
	match fs_type {
		"smbfs" | "cifs" | "smb3" => Some("SMB"),
		"nfs" | "nfs4" => Some("NFS"),
		"afpfs" => Some("AFP"),
		"webdav" | "davfs" => Some("WebDAV"),
		"fuse.sshfs" => Some("SFTP"),
		_ => None,
	}
}

// The machine a share is mounted from, out of where the mount table says it
// came from: `//user@host/share` (SMB, AFP), `\\host\share` (Windows),
// `host:/export` (NFS), `user@host:path` (sshfs), or a URL (WebDAV). A
// Bonjour name (`Pecha._smb._tcp.local`) comes out as just the name.
fn share_server(source: &str) -> Option<String> {
	let host = if let Some(unc) = source.strip_prefix(r"\\") {
		// `\\host@SSL@8443\DavWWWRoot`: after an @ is how to connect.
		unc.split(['\\', '@']).next()?
	} else {
		let authority = match source
			.strip_prefix("//")
			.or_else(|| Some(source.split_once("://")?.1))
		{
			Some(rest) => rest.split('/').next()?,
			None => {
				source
					.split_once(":/")
					.or_else(|| source.split_once(':'))?
					.0
			}
		};
		// Leaves off the user (`user@`, `DOMAIN;user@`) and the port.
		let host = authority
			.rsplit_once('@')
			.map_or(authority, |(_, host)| host);
		match host.rsplit_once(':') {
			Some((host, port)) if port.parse::<u16>().is_ok() => host,
			_ => host,
		}
	};
	let host = unescape(host, "%", 2, 16);
	let host = host
		.split_once("._")
		.map_or(host.as_str(), |(name, _)| name);
	let host = host.strip_suffix(".local").unwrap_or(host);
	(!host.is_empty()).then(|| host.to_owned())
}

// Replaces each `marker` followed by `width` digits in `radix` with the
// byte they spell out, leaving anything that doesn't fit the pattern.
fn unescape(text: &str, marker: &str, width: usize, radix: u32) -> String {
	let mut out = Vec::with_capacity(text.len());
	let mut rest = text.as_bytes();
	while let Some((&first, tail)) = rest.split_first() {
		let escaped = rest
			.strip_prefix(marker.as_bytes())
			.and_then(|digits| digits.get(..width))
			.and_then(|digits| byte_from_digits(digits, radix));
		match escaped {
			Some(byte) => {
				out.push(byte);
				rest = &rest[marker.len() + width..];
			}
			None => {
				out.push(first);
				rest = tail;
			}
		}
	}
	String::from_utf8_lossy(&out).into_owned()
}

fn byte_from_digits(digits: &[u8], radix: u32) -> Option<u8> {
	// from_str_radix would take a leading sign too.
	if !digits.iter().all(u8::is_ascii_alphanumeric) {
		return None;
	}
	u8::from_str_radix(std::str::from_utf8(digits).ok()?, radix).ok()
}

#[cfg(target_os = "macos")]
mod macos {
	use super::{Volume, share_protocol, share_server};
	use std::ffi::{CString, c_char, c_void};
	use std::path::Path;

	pub fn volumes() -> Vec<Volume> {
		let disks = DiskArbitration::new();
		let mounts = mounts();
		// `/` is a sealed snapshot of the system volume, which FileVault
		// leaves alone. It encrypts the Data volume paired with it, where
		// everything but macOS itself lives.
		let data_encrypted = mounts
			.iter()
			.find(|mount| c_str(&mount.f_mntonname) == "/System/Volumes/Data")
			.and_then(|mount| describe(mount, disks.as_ref()))
			.is_some_and(|disk| disk.encrypted);
		mounts
			.iter()
			.filter_map(|mount| volume(mount, disks.as_ref()))
			.map(|mut volume| {
				volume.encrypted |= volume.startup && data_encrypted;
				volume
			})
			.collect()
	}

	fn volume(mount: &libc::statfs, disks: Option<&DiskArbitration>) -> Option<Volume> {
		let flags = mount.f_flags as libc::c_int;
		let fs_type = c_str(&mount.f_fstypename);
		let path = c_str(&mount.f_mntonname);

		// Finder leaves out `nobrowse` mounts: the system's own volumes under
		// /System/Volumes, simulator runtimes, Time Machine's snapshots and
		// the shares it backs up to. The automounter's trigger points aren't
		// mounts of anything until something steps into them.
		if flags & libc::MNT_DONTBROWSE != 0 || fs_type == "autofs" {
			return None;
		}
		let base_name = || {
			Path::new(&path)
				.file_name()
				.map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned())
		};

		if flags & libc::MNT_LOCAL == 0 {
			let source = c_str(&mount.f_mntfromname);
			return Some(Volume {
				name: base_name(),
				path,
				network: true,
				startup: false,
				external: false,
				encrypted: false,
				server: share_server(&source),
				protocol: share_protocol(&fs_type).map(str::to_owned),
			});
		}

		// A local volume that isn't on a disk isn't one anyone would scan.
		if !c_str(&mount.f_mntfromname).starts_with("/dev/") {
			return None;
		}
		let disk = describe(mount, disks);
		// Disk images (mounted .dmg files, Time Machine's network backups)
		// attach through a "Virtual Interface". Real disks, and the APFS
		// containers synthesized on top of them, report their hardware bus.
		if disk
			.as_ref()
			.is_some_and(|disk| disk.protocol.as_deref() == Some("Virtual Interface"))
		{
			return None;
		}
		Some(Volume {
			name: disk
				.as_ref()
				.and_then(|disk| disk.volume_name.clone())
				.unwrap_or_else(base_name),
			path,
			network: false,
			startup: flags & libc::MNT_ROOTFS != 0,
			// A USB or Thunderbolt disk is ejectable without being removable,
			// and an SD card in a built-in reader is on an internal device.
			external: disk
				.as_ref()
				.is_some_and(|disk| !disk.internal || disk.ejectable),
			encrypted: disk.is_some_and(|disk| disk.encrypted),
			server: None,
			protocol: None,
		})
	}

	// What DiskArbitration knows about the disk a mount is on.
	fn describe(mount: &libc::statfs, disks: Option<&DiskArbitration>) -> Option<DiskDescription> {
		let source = c_str(&mount.f_mntfromname);
		disks?.describe(source.strip_prefix("/dev/")?)
	}

	// Every mounted filesystem. MNT_NOWAIT has the kernel answer from what it
	// has on hand rather than having each filesystem (and so each file
	// server) refresh its stats first.
	fn mounts() -> Vec<libc::statfs> {
		let count = unsafe { libc::getfsstat(std::ptr::null_mut(), 0, libc::MNT_NOWAIT) };
		let Ok(count) = usize::try_from(count) else {
			return Vec::new();
		};
		let mut mounts = Vec::<libc::statfs>::with_capacity(count);
		let bytes = mounts.capacity() * std::mem::size_of::<libc::statfs>();
		let filled =
			unsafe { libc::getfsstat(mounts.as_mut_ptr(), bytes as libc::c_int, libc::MNT_NOWAIT) };
		let filled = usize::try_from(filled).unwrap_or(0).min(mounts.capacity());
		// SAFETY: getfsstat filled in that many entries, and never more than
		// fit in the buffer.
		unsafe { mounts.set_len(filled) };
		mounts
	}

	// The text up to the first NUL of a fixed-size C string buffer.
	fn c_str(chars: &[c_char]) -> String {
		let bytes: Vec<u8> = chars
			.iter()
			.take_while(|&&c| c != 0)
			.map(|&c| c as u8)
			.collect();
		String::from_utf8_lossy(&bytes).into_owned()
	}

	// Just enough of DiskArbitration, and the CoreFoundation it speaks, to
	// read what Disk Utility shows about a disk.
	type CFTypeRef = *const c_void;

	#[link(name = "CoreFoundation", kind = "framework")]
	unsafe extern "C" {
		fn CFRelease(cf: CFTypeRef);
		fn CFGetTypeID(cf: CFTypeRef) -> usize;
		fn CFStringGetTypeID() -> usize;
		fn CFBooleanGetTypeID() -> usize;
		fn CFBooleanGetValue(boolean: CFTypeRef) -> u8;
		fn CFStringGetCString(
			string: CFTypeRef,
			buffer: *mut c_char,
			size: isize,
			encoding: u32,
		) -> u8;
		fn CFDictionaryGetValue(dictionary: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
	}

	const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

	#[link(name = "DiskArbitration", kind = "framework")]
	unsafe extern "C" {
		static kDADiskDescriptionDeviceInternalKey: CFTypeRef;
		static kDADiskDescriptionDeviceProtocolKey: CFTypeRef;
		static kDADiskDescriptionMediaEjectableKey: CFTypeRef;
		static kDADiskDescriptionMediaEncryptedKey: CFTypeRef;
		static kDADiskDescriptionVolumeNameKey: CFTypeRef;
		fn DASessionCreate(allocator: CFTypeRef) -> CFTypeRef;
		fn DADiskCreateFromBSDName(
			allocator: CFTypeRef,
			session: CFTypeRef,
			name: *const c_char,
		) -> CFTypeRef;
		fn DADiskCopyDescription(disk: CFTypeRef) -> CFTypeRef;
	}

	struct DiskArbitration(CFTypeRef);

	struct DiskDescription {
		protocol: Option<String>,
		volume_name: Option<String>,
		internal: bool,
		ejectable: bool,
		encrypted: bool,
	}

	impl DiskArbitration {
		fn new() -> Option<Self> {
			let session = unsafe { DASessionCreate(std::ptr::null()) };
			(!session.is_null()).then_some(Self(session))
		}

		// `bsd_name` is the disk's device name, like "disk3s1".
		fn describe(&self, bsd_name: &str) -> Option<DiskDescription> {
			let bsd_name = CString::new(bsd_name).ok()?;
			unsafe {
				let disk = DADiskCreateFromBSDName(std::ptr::null(), self.0, bsd_name.as_ptr());
				if disk.is_null() {
					return None;
				}
				let description = DADiskCopyDescription(disk);
				CFRelease(disk);
				if description.is_null() {
					return None;
				}
				let value = |key| CFDictionaryGetValue(description, key);
				let found = DiskDescription {
					protocol: cf_string(value(kDADiskDescriptionDeviceProtocolKey)),
					volume_name: cf_string(value(kDADiskDescriptionVolumeNameKey)),
					// Without a say either way, it's a disk like the startup one.
					internal: cf_bool(value(kDADiskDescriptionDeviceInternalKey)).unwrap_or(true),
					ejectable: cf_bool(value(kDADiskDescriptionMediaEjectableKey)) == Some(true),
					encrypted: cf_bool(value(kDADiskDescriptionMediaEncryptedKey)) == Some(true),
				};
				CFRelease(description);
				Some(found)
			}
		}
	}

	impl Drop for DiskArbitration {
		fn drop(&mut self) {
			unsafe { CFRelease(self.0) };
		}
	}

	// A CFString's text; None for null or anything that isn't a string.
	unsafe fn cf_string(value: CFTypeRef) -> Option<String> {
		if value.is_null() || unsafe { CFGetTypeID(value) != CFStringGetTypeID() } {
			return None;
		}
		let mut buffer = [0 as c_char; 1024];
		let copied = unsafe {
			CFStringGetCString(
				value,
				buffer.as_mut_ptr(),
				buffer.len() as isize,
				CF_STRING_ENCODING_UTF8,
			)
		};
		(copied != 0).then(|| c_str(&buffer))
	}

	// A CFBoolean's value; None for null or anything that isn't a boolean.
	unsafe fn cf_bool(value: CFTypeRef) -> Option<bool> {
		if value.is_null() || unsafe { CFGetTypeID(value) != CFBooleanGetTypeID() } {
			return None;
		}
		Some(unsafe { CFBooleanGetValue(value) } != 0)
	}
}

#[cfg(any(target_os = "linux", test))]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux {
	use super::{Volume, share_protocol, share_server, unescape};
	use std::collections::HashMap;
	use std::fs;
	use std::path::{Path, PathBuf};

	pub fn volumes() -> Vec<Volume> {
		let Ok(table) = fs::read_to_string("/proc/self/mounts") else {
			return Vec::new();
		};
		let labels = labels();
		let sys = Path::new("/sys/class/block");
		parse_mounts(&table)
			.into_iter()
			.filter_map(|mount| {
				let network = is_network(&mount)?;
				let device = if network {
					None
				} else {
					fs::canonicalize(&mount.source).ok()
				};
				let label = device
					.as_ref()
					.and_then(|device| labels.get(device).cloned());
				let stack = device
					.as_ref()
					.and_then(|device| device.file_name())
					.map(|name| block_stack(sys, name.as_ref()))
					.unwrap_or_default();
				let name = label
					.or_else(|| {
						let name = Path::new(&mount.path).file_name()?;
						Some(name.to_string_lossy().into_owned())
					})
					.unwrap_or_else(|| "File System".to_owned());
				Some(Volume {
					startup: mount.path == "/",
					external: is_external(&stack),
					encrypted: is_encrypted(&stack),
					server: network.then(|| share_server(&mount.source)).flatten(),
					protocol: share_protocol(&mount.fs_type).map(str::to_owned),
					path: mount.path,
					name,
					network,
				})
			})
			.collect()
	}

	pub(super) struct Mount {
		pub source: String,
		pub path: String,
		pub fs_type: String,
	}

	// Whether a mount is a network share, a disk, or (None) neither: procfs,
	// tmpfs, cgroups, and the rest of what a Linux mount table is mostly made
	// of. Disks mount from a device node, but loop devices are files mounted
	// as disks (snap packages, mostly), so they're left out.
	pub(super) fn is_network(mount: &Mount) -> Option<bool> {
		if share_protocol(&mount.fs_type).is_some() {
			Some(true)
		} else if mount.source.starts_with("/dev/") && !mount.source.starts_with("/dev/loop") {
			Some(false)
		} else {
			None
		}
	}

	// The sysfs entries (under `sys`, /sys/class/block) of block device
	// `name` and everything it's built on: for a device-mapper volume (LVM,
	// LUKS) or RAID array, what it maps onto, on down to the partitions.
	pub(super) fn block_stack(sys: &Path, name: &Path) -> Vec<PathBuf> {
		let mut stack = Vec::new();
		let mut pending = vec![sys.join(name)];
		while let Some(device) = pending.pop() {
			if let Ok(below) = fs::read_dir(device.join("slaves")) {
				pending.extend(below.flatten().map(|entry| sys.join(entry.file_name())));
			}
			stack.push(device);
		}
		stack
	}

	// Somewhere in the stack is a dm-crypt mapping (LUKS, or plain dm-crypt).
	pub(super) fn is_encrypted(stack: &[PathBuf]) -> bool {
		stack.iter().any(|device| {
			fs::read_to_string(device.join("dm/uuid")).is_ok_and(|uuid| uuid.starts_with("CRYPT-"))
		})
	}

	// sysfs files each block device under the path of buses that leads to
	// it, so a disk plugged in over USB has a USB host controller in there.
	pub(super) fn is_external(stack: &[PathBuf]) -> bool {
		stack.iter().any(|device| {
			fs::canonicalize(device).is_ok_and(|path| path.to_string_lossy().contains("/usb"))
		})
	}

	// The lines of /proc/self/mounts go `source path type options dump pass`,
	// with whitespace and backslashes in a field octal-escaped (`\040`).
	pub(super) fn parse_mounts(table: &str) -> Vec<Mount> {
		table
			.lines()
			.filter_map(|line| {
				let mut fields = line.split(' ');
				Some(Mount {
					source: unescape(fields.next()?, "\\", 3, 8),
					path: unescape(fields.next()?, "\\", 3, 8),
					fs_type: fields.next()?.to_owned(),
				})
			})
			.collect()
	}

	// Filesystem labels by device node, from the symlinks udev keeps in
	// /dev/disk/by-label (named with hex escapes like `\x20`).
	fn labels() -> HashMap<PathBuf, String> {
		let Ok(entries) = fs::read_dir("/dev/disk/by-label") else {
			return HashMap::new();
		};
		entries
			.flatten()
			.filter_map(|entry| {
				let device = fs::canonicalize(entry.path()).ok()?;
				let label = unescape(&entry.file_name().to_string_lossy(), "\\x", 2, 16);
				Some((device, label))
			})
			.collect()
	}
}

#[cfg(windows)]
mod windows {
	use super::{Volume, share_server};
	use std::ffi::c_void;
	use std::ptr::{null, null_mut};

	const DRIVE_REMOVABLE: u32 = 2;
	const DRIVE_FIXED: u32 = 3;
	const DRIVE_REMOTE: u32 = 4;
	const SEM_FAILCRITICALERRORS: u32 = 0x0001;
	const NO_ERROR: u32 = 0;
	const ERROR_CONNECTION_UNAVAIL: u32 = 1201;
	const FILE_SHARE_READ: u32 = 0x1;
	const FILE_SHARE_WRITE: u32 = 0x2;
	const OPEN_EXISTING: u32 = 3;
	const INVALID_HANDLE_VALUE: *mut c_void = -1isize as *mut c_void;
	const IOCTL_STORAGE_QUERY_PROPERTY: u32 = 0x002D_1400;
	// STORAGE_BUS_TYPE values for buses a disk plugs in over.
	const BUS_TYPE_1394: u32 = 0x4;
	const BUS_TYPE_USB: u32 = 0x7;
	const BUS_TYPE_SD: u32 = 0xC;
	const BUS_TYPE_MMC: u32 = 0xD;

	#[link(name = "kernel32")]
	unsafe extern "system" {
		fn GetLogicalDrives() -> u32;
		fn GetDriveTypeW(root: *const u16) -> u32;
		fn GetVolumeInformationW(
			root: *const u16,
			name: *mut u16,
			name_size: u32,
			serial_number: *mut u32,
			max_component_length: *mut u32,
			flags: *mut u32,
			fs_name: *mut u16,
			fs_name_size: u32,
		) -> i32;
		fn SetThreadErrorMode(mode: u32, previous: *mut u32) -> i32;
		fn CreateFileW(
			name: *const u16,
			access: u32,
			share_mode: u32,
			security: *const c_void,
			disposition: u32,
			flags: u32,
			template: *mut c_void,
		) -> *mut c_void;
		fn DeviceIoControl(
			device: *mut c_void,
			code: u32,
			input: *const c_void,
			input_size: u32,
			output: *mut c_void,
			output_size: u32,
			returned: *mut u32,
			overlapped: *mut c_void,
		) -> i32;
		fn CloseHandle(handle: *mut c_void) -> i32;
	}

	#[link(name = "mpr")]
	unsafe extern "system" {
		fn WNetGetConnectionW(local: *const u16, remote: *mut u16, size: *mut u32) -> u32;
	}

	// STORAGE_PROPERTY_QUERY, asking for the STORAGE_DEVICE_DESCRIPTOR.
	#[repr(C)]
	struct StoragePropertyQuery {
		property_id: u32,
		query_type: u32,
		additional_parameters: [u8; 1],
	}

	// The start of a STORAGE_DEVICE_DESCRIPTOR, through its bus type.
	#[repr(C)]
	#[derive(Default)]
	struct StorageDeviceDescriptor {
		version: u32,
		size: u32,
		device_type: u8,
		device_type_modifier: u8,
		removable_media: u8,
		command_queueing: u8,
		vendor_id_offset: u32,
		product_id_offset: u32,
		product_revision_offset: u32,
		serial_number_offset: u32,
		bus_type: u32,
	}

	pub fn volumes() -> Vec<Volume> {
		// Otherwise asking an empty card reader for its label puts up a
		// "There is no disk in the drive" dialog.
		let mut previous_mode = 0;
		unsafe { SetThreadErrorMode(SEM_FAILCRITICALERRORS, &mut previous_mode) };
		let letters = unsafe { GetLogicalDrives() };
		// "C:", normally.
		let system_drive = std::env::var("SystemDrive").unwrap_or_default();
		let found = (0..26u8)
			.filter(|i| letters & (1 << i) != 0)
			.filter_map(|i| volume(char::from(b'A' + i), &system_drive))
			.collect();
		unsafe { SetThreadErrorMode(previous_mode, null_mut()) };
		found
	}

	fn volume(letter: char, system_drive: &str) -> Option<Volume> {
		let path = format!("{letter}:\\");
		let root = wide(&path);
		match unsafe { GetDriveTypeW(root.as_ptr()) } {
			// Named after the share it's mapped to, which Windows remembers
			// locally, so a server that has gone away doesn't hold this up.
			DRIVE_REMOTE => {
				let remote = remote_path(letter);
				let share = remote.as_deref().and_then(|remote| {
					let share = remote.rsplit('\\').find(|part| !part.is_empty())?;
					Some(share.to_owned())
				});
				// The WebClient service maps WebDAV folders as
				// `\\host@SSL\DavWWWRoot\…`.
				let webdav = remote
					.as_deref()
					.is_some_and(|remote| remote.to_ascii_lowercase().contains("\\davwwwroot"));
				Some(Volume {
					path,
					name: share.unwrap_or_else(|| "Network Drive".to_owned()),
					network: true,
					startup: false,
					external: false,
					encrypted: false,
					server: remote.as_deref().and_then(share_server),
					protocol: Some(if webdav { "WebDAV" } else { "SMB" }.to_owned()),
				})
			}
			// Without a label, Explorer calls it "Local Disk" too. No label at
			// all means no media in the drive, like an empty card reader.
			kind @ (DRIVE_FIXED | DRIVE_REMOVABLE) => {
				let label = volume_label(&root)?;
				Some(Volume {
					name: if label.is_empty() {
						"Local Disk".to_owned()
					} else {
						label
					},
					startup: system_drive.eq_ignore_ascii_case(&format!("{letter}:")),
					// USB sticks and SD cards are "removable"; disks in USB
					// enclosures are "fixed", so ask what they're plugged into.
					external: kind == DRIVE_REMOVABLE
						|| matches!(
							bus_type(letter),
							Some(BUS_TYPE_1394 | BUS_TYPE_USB | BUS_TYPE_SD | BUS_TYPE_MMC)
						),
					encrypted: false,
					server: None,
					protocol: None,
					path,
					network: false,
				})
			}
			// CD drives, RAM disks, and letters that don't lead anywhere.
			_ => None,
		}
	}

	fn volume_label(root: &[u16]) -> Option<String> {
		let mut name = [0u16; 261];
		let ok = unsafe {
			GetVolumeInformationW(
				root.as_ptr(),
				name.as_mut_ptr(),
				name.len() as u32,
				null_mut(),
				null_mut(),
				null_mut(),
				null_mut(),
				0,
			)
		};
		(ok != 0).then(|| from_wide(&name))
	}

	// The `\\server\share` a drive letter is mapped to.
	fn remote_path(letter: char) -> Option<String> {
		let local = wide(&format!("{letter}:"));
		let mut remote = [0u16; 1024];
		let mut size = remote.len() as u32;
		let status = unsafe { WNetGetConnectionW(local.as_ptr(), remote.as_mut_ptr(), &mut size) };
		if status != NO_ERROR && status != ERROR_CONNECTION_UNAVAIL {
			return None;
		}
		Some(from_wide(&remote))
	}

	// The STORAGE_BUS_TYPE of the disk a drive letter is on. Opening the
	// volume without asking for read or write access is enough to query it,
	// and doesn't take an admin.
	fn bus_type(letter: char) -> Option<u32> {
		let volume = wide(&format!(r"\\.\{letter}:"));
		let handle = unsafe {
			CreateFileW(
				volume.as_ptr(),
				0,
				FILE_SHARE_READ | FILE_SHARE_WRITE,
				null(),
				OPEN_EXISTING,
				0,
				null_mut(),
			)
		};
		if handle == INVALID_HANDLE_VALUE {
			return None;
		}
		// StorageDeviceProperty, PropertyStandardQuery.
		let query = StoragePropertyQuery {
			property_id: 0,
			query_type: 0,
			additional_parameters: [0],
		};
		let mut descriptor = StorageDeviceDescriptor::default();
		let mut returned = 0;
		let ok = unsafe {
			DeviceIoControl(
				handle,
				IOCTL_STORAGE_QUERY_PROPERTY,
				(&raw const query).cast(),
				size_of::<StoragePropertyQuery>() as u32,
				(&raw mut descriptor).cast(),
				size_of::<StorageDeviceDescriptor>() as u32,
				&mut returned,
				null_mut(),
			)
		};
		unsafe { CloseHandle(handle) };
		// Fills in as much of the descriptor as there's room for.
		(ok != 0 && returned as usize >= size_of::<StorageDeviceDescriptor>())
			.then_some(descriptor.bus_type)
	}

	fn wide(text: &str) -> Vec<u16> {
		text.encode_utf16().chain([0]).collect()
	}

	fn from_wide(buffer: &[u16]) -> String {
		let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
		String::from_utf16_lossy(&buffer[..end])
	}
}

#[cfg(test)]
mod tests {
	use super::linux::{Mount, block_stack, is_encrypted, is_external, is_network, parse_mounts};
	use super::{share_server, unescape};
	use std::path::Path;

	#[test]
	fn picks_disks_and_shares_out_of_the_linux_mount_table() {
		let table = "\
/dev/nvme0n1p2 / ext4 rw,relatime 0 0
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
/dev/loop3 /snap/core22/1380 squashfs ro,nodev,relatime 0 0
/dev/sdb1 /media/kayla/My\\040Passport exfat rw 0 0
//nas/media /mnt/media cifs rw,vers=3.1.1 0 0
nas:/export/backups /mnt/backups nfs4 rw 0 0
tmpfs /run/user/1000 tmpfs rw 0 0
";
		let found: Vec<(String, bool)> = parse_mounts(table)
			.into_iter()
			.filter_map(|mount| Some((mount.path.clone(), is_network(&mount)?)))
			.collect();
		let expected = [
			("/", false),
			("/media/kayla/My Passport", false),
			("/mnt/media", true),
			("/mnt/backups", true),
		];
		assert_eq!(
			found,
			expected.map(|(path, network)| (path.to_owned(), network))
		);
	}

	#[test]
	fn leaves_a_mount_without_a_type_out() {
		assert!(parse_mounts("/dev/sda1 /mnt").is_empty());
		let mount = Mount {
			source: "overlay".into(),
			path: "/".into(),
			fs_type: "overlay".into(),
		};
		assert_eq!(is_network(&mount), None);
	}

	#[test]
	fn unescapes_octal_and_hex_and_leaves_stray_backslashes() {
		assert_eq!(unescape("a\\040b\\134c", "\\", 3, 8), "a b\\c");
		assert_eq!(unescape("a\\9b\\04", "\\", 3, 8), "a\\9b\\04");
		assert_eq!(unescape("My\\x20Disk", "\\x", 2, 16), "My Disk");
		assert_eq!(unescape("a\\x-1", "\\x", 2, 16), "a\\x-1");
	}

	#[test]
	fn names_the_server_a_share_is_from() {
		let cases = [
			("//kayla@Pecha._smb._tcp.local/isos", "Pecha"),
			("//WORKGROUP;kayla@nas.local:445/media", "nas"),
			(
				"//kayla@Kayla%27s%20NAS._afpovertcp._tcp.local/Backup",
				"Kayla's NAS",
			),
			("//192.168.1.20/media", "192.168.1.20"),
			("nas:/export/backups", "nas"),
			("[fd00::20]:/export", "[fd00::20]"),
			("kayla@build-box:", "build-box"),
			(
				"https://dav.example.com/remote.php/webdav",
				"dav.example.com",
			),
			(r"\\pecha\isos", "pecha"),
			(
				r"\\dav.example.com@SSL@8443\DavWWWRoot\files",
				"dav.example.com",
			),
		];
		for (source, server) in cases {
			assert_eq!(share_server(source).as_deref(), Some(server), "{source}");
		}
		assert_eq!(share_server("map auto_home"), None);
	}

	// A LUKS volume with LVM on top on an internal NVMe disk, and a USB
	// stick, laid out the way /sys/class/block shows them.
	#[cfg(unix)]
	#[test]
	fn reads_encryption_and_bus_out_of_sysfs() {
		use std::fs;
		use std::os::unix::fs::symlink;

		let sys = std::env::temp_dir().join(format!("observatory-sysfs-{}", std::process::id()));
		let _ = fs::remove_dir_all(&sys);
		let devices = [
			(
				"nvme0n1p3",
				"pci0000:00/0000:00:1d.0/nvme/nvme0/nvme0n1/nvme0n1p3",
			),
			(
				"sdb1",
				"pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host6/block/sdb/sdb1",
			),
			("dm-0", "virtual/block/dm-0"),
			("dm-1", "virtual/block/dm-1"),
		];
		let class = sys.join("class/block");
		fs::create_dir_all(&class).unwrap();
		for (name, path) in devices {
			let device = sys.join("devices").join(path);
			fs::create_dir_all(device.join("slaves")).unwrap();
			symlink(&device, class.join(name)).unwrap();
		}
		fs::create_dir_all(class.join("dm-0/dm")).unwrap();
		fs::write(
			class.join("dm-0/dm/uuid"),
			"CRYPT-LUKS2-0123abcd-cryptroot\n",
		)
		.unwrap();
		fs::write(class.join("dm-0/slaves/nvme0n1p3"), "").unwrap();
		fs::create_dir_all(class.join("dm-1/dm")).unwrap();
		fs::write(class.join("dm-1/dm/uuid"), "LVM-wxyz\n").unwrap();
		fs::write(class.join("dm-1/slaves/dm-0"), "").unwrap();

		let root = block_stack(&class, Path::new("dm-1"));
		assert_eq!(root.len(), 3);
		assert!(is_encrypted(&root));
		assert!(!is_external(&root));
		let stick = block_stack(&class, Path::new("sdb1"));
		assert!(!is_encrypted(&stick));
		assert!(is_external(&stick));
		fs::remove_dir_all(&sys).unwrap();
	}

	#[cfg(target_os = "macos")]
	#[test]
	fn finds_the_boot_volume() {
		let volumes = super::volumes();
		let boot = volumes.iter().find(|volume| volume.path == "/");
		assert!(boot.is_some_and(|boot| boot.startup && !boot.network && !boot.name.is_empty()));
	}
}
