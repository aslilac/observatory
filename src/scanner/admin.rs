// Running as an administrator on Windows.
//
// A standard account, or an administrator's before Windows elevates it, can't
// list a good part of a Windows disk: other accounts' folders, most of
// ProgramData, WindowsApps, System32\config, Windows Defender's folders, and
// so on. A whole-disk scan turns up a couple hundred. Elevated, the scanner
// turns on the backup privilege, which lets it list any folder whatever its
// permissions, the way backup software and WinDirStat do. It only ever lists
// folders; it never reads what's in a file.
//
// Without it, the folders Windows kept the scan out of are one issue, with
// one fix: start the app again as an administrator, which Windows asks the
// user about (UAC).

use std::io;
use std::iter::repeat_n;
use std::path::Path;
use std::sync::OnceLock;

/// Whether the walk can list every folder: the app is elevated, and has the
/// backup privilege on. The first call turns it on, for the whole process.
pub fn can_list_everything() -> bool {
	static ENABLED: OnceLock<bool> = OnceLock::new();
	*ENABLED.get_or_init(|| {
		#[cfg(windows)]
		{
			windows::enable_backup_privilege()
		}
		#[cfg(not(windows))]
		{
			false
		}
	})
}

/// Whether `path` is on a disk of this computer's own, rather than a network
/// share, where being an administrator here makes no difference (and where
/// an elevated app can't see the user's mapped drive letters anyway).
pub fn is_local(path: &Path) -> bool {
	#[cfg(windows)]
	{
		windows::is_local(path)
	}
	#[cfg(not(windows))]
	{
		let _ = path;
		false
	}
}

/// Starts `file` with `args` in `directory` as an administrator, once the
/// user agrees to it when Windows asks. False if they said no. `window` (an
/// HWND, or 0) is the window asking, so Windows' prompt comes up in front
/// rather than as a flashing taskbar button. Waits for the user's answer.
pub fn relaunch_elevated(
	window: usize,
	file: &str,
	args: &[String],
	directory: &str,
) -> io::Result<bool> {
	#[cfg(windows)]
	{
		windows::relaunch_elevated(window, file, &command_line(args), directory)
	}
	#[cfg(not(windows))]
	{
		let _ = (window, file, args, directory);
		Err(io::Error::from(io::ErrorKind::Unsupported))
	}
}

// Joins `args` into one command line the way the program on the other end
// (anything using the C runtime's or CommandLineToArgvW's rules, Electron
// included) splits it back up. Backslashes are only special before a quote,
// so `C:\` stays as it is, but in quotes it has to be `"C:\\"`.
#[cfg_attr(not(windows), allow(dead_code))]
fn command_line(args: &[String]) -> String {
	args.iter()
		.map(|arg| quote(arg))
		.collect::<Vec<_>>()
		.join(" ")
}

fn quote(arg: &str) -> String {
	if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\u{b}', '"']) {
		return arg.to_owned();
	}
	let mut quoted = String::from('"');
	let mut backslashes = 0;
	for c in arg.chars() {
		match c {
			'\\' => backslashes += 1,
			'"' => {
				quoted.extend(repeat_n('\\', backslashes * 2 + 1));
				quoted.push('"');
				backslashes = 0;
			}
			_ => {
				quoted.extend(repeat_n('\\', backslashes));
				quoted.push(c);
				backslashes = 0;
			}
		}
	}
	quoted.extend(repeat_n('\\', backslashes * 2));
	quoted.push('"');
	quoted
}

#[cfg(windows)]
mod windows {
	use std::ffi::{OsStr, c_void};
	use std::io;
	use std::os::windows::ffi::OsStrExt;
	use std::path::{Component, Path, Prefix};
	use std::ptr::{null, null_mut};

	const TOKEN_ADJUST_PRIVILEGES: u32 = 0x0020;
	const SE_PRIVILEGE_ENABLED: u32 = 0x0002;
	const ERROR_NOT_ALL_ASSIGNED: i32 = 1300;
	const ERROR_CANCELLED: i32 = 1223;
	const DRIVE_REMOTE: u32 = 4;
	const SEE_MASK_NOASYNC: u32 = 0x0100;
	const SW_SHOWNORMAL: i32 = 1;

	#[repr(C)]
	struct Luid {
		low_part: u32,
		high_part: i32,
	}

	#[repr(C)]
	struct LuidAndAttributes {
		luid: Luid,
		attributes: u32,
	}

	// TOKEN_PRIVILEGES, with room for the one.
	#[repr(C)]
	struct TokenPrivileges {
		privilege_count: u32,
		privileges: [LuidAndAttributes; 1],
	}

	// SHELLEXECUTEINFOW.
	#[repr(C)]
	struct ShellExecuteInfo {
		size: u32,
		mask: u32,
		hwnd: *mut c_void,
		verb: *const u16,
		file: *const u16,
		parameters: *const u16,
		directory: *const u16,
		show: i32,
		instance: *mut c_void,
		id_list: *mut c_void,
		class: *const u16,
		class_key: *mut c_void,
		hot_key: u32,
		icon_or_monitor: *mut c_void,
		process: *mut c_void,
	}

	#[link(name = "kernel32")]
	unsafe extern "system" {
		fn GetCurrentProcess() -> *mut c_void;
		fn CloseHandle(handle: *mut c_void) -> i32;
		fn GetDriveTypeW(root: *const u16) -> u32;
	}

	#[link(name = "advapi32")]
	unsafe extern "system" {
		fn OpenProcessToken(process: *mut c_void, access: u32, token: *mut *mut c_void) -> i32;
		fn LookupPrivilegeValueW(system: *const u16, name: *const u16, luid: *mut Luid) -> i32;
		fn AdjustTokenPrivileges(
			token: *mut c_void,
			disable_all: i32,
			new_state: *const TokenPrivileges,
			buffer_length: u32,
			previous_state: *mut c_void,
			return_length: *mut u32,
		) -> i32;
	}

	#[link(name = "shell32")]
	unsafe extern "system" {
		fn ShellExecuteExW(info: *mut ShellExecuteInfo) -> i32;
	}

	fn wide(s: impl AsRef<OsStr>) -> Vec<u16> {
		s.as_ref().encode_wide().chain(Some(0)).collect()
	}

	// An elevated administrator's token has the backup privilege, but off.
	// Anyone else's doesn't have it at all, which AdjustTokenPrivileges
	// reports by succeeding with ERROR_NOT_ALL_ASSIGNED.
	pub fn enable_backup_privilege() -> bool {
		let mut token = null_mut();
		// SAFETY: the current process's pseudo-handle needs no closing, and
		// `token` is written to only on success.
		if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES, &mut token) }
			== 0
		{
			return false;
		}
		let name = wide("SeBackupPrivilege");
		let mut luid = Luid {
			low_part: 0,
			high_part: 0,
		};
		// SAFETY: `name` is NUL-terminated and outlives the call.
		let found = unsafe { LookupPrivilegeValueW(null(), name.as_ptr(), &mut luid) } != 0;
		let enabled = found && {
			let privileges = TokenPrivileges {
				privilege_count: 1,
				privileges: [LuidAndAttributes {
					luid,
					attributes: SE_PRIVILEGE_ENABLED,
				}],
			};
			// SAFETY: `token` is open with TOKEN_ADJUST_PRIVILEGES, and the
			// previous state isn't asked for.
			let ok =
				unsafe { AdjustTokenPrivileges(token, 0, &privileges, 0, null_mut(), null_mut()) }
					!= 0;
			ok && io::Error::last_os_error().raw_os_error() != Some(ERROR_NOT_ALL_ASSIGNED)
		};
		// SAFETY: `token` was opened above and isn't used after this.
		unsafe { CloseHandle(token) };
		enabled
	}

	pub fn is_local(path: &Path) -> bool {
		let Some(Component::Prefix(prefix)) = path.components().next() else {
			return false;
		};
		// \\server\share, and device paths, are never this computer's disks.
		let (Prefix::Disk(letter) | Prefix::VerbatimDisk(letter)) = prefix.kind() else {
			return false;
		};
		let root = wide(format!("{}:\\", letter as char));
		// SAFETY: `root` is NUL-terminated and outlives the call.
		unsafe { GetDriveTypeW(root.as_ptr()) != DRIVE_REMOTE }
	}

	pub fn relaunch_elevated(
		window: usize,
		file: &str,
		parameters: &str,
		directory: &str,
	) -> io::Result<bool> {
		let verb = wide("runas");
		let file = wide(file);
		let parameters = wide(parameters);
		let directory = wide(directory);
		let mut info = ShellExecuteInfo {
			size: size_of::<ShellExecuteInfo>() as u32,
			mask: SEE_MASK_NOASYNC,
			hwnd: window as *mut c_void,
			verb: verb.as_ptr(),
			file: file.as_ptr(),
			parameters: parameters.as_ptr(),
			directory: directory.as_ptr(),
			show: SW_SHOWNORMAL,
			instance: null_mut(),
			id_list: null_mut(),
			class: null(),
			class_key: null_mut(),
			hot_key: 0,
			icon_or_monitor: null_mut(),
			process: null_mut(),
		};
		// SAFETY: every string is NUL-terminated and outlives the call, and
		// `info.size` says which version of the struct this is.
		if unsafe { ShellExecuteExW(&mut info) } != 0 {
			return Ok(true);
		}
		let err = io::Error::last_os_error();
		if err.raw_os_error() == Some(ERROR_CANCELLED) {
			Ok(false)
		} else {
			Err(err)
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn line(args: &[&str]) -> String {
		command_line(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>())
	}

	#[test]
	fn leaves_plain_arguments_alone() {
		assert_eq!(line(&[".", "--scan=C:\\"]), ". --scan=C:\\");
		assert_eq!(line(&["--scan=D:\\Games"]), "--scan=D:\\Games");
	}

	#[test]
	fn quotes_spaces_and_doubles_backslashes_before_the_closing_quote() {
		assert_eq!(
			line(&["--scan=C:\\Program Files\\"]),
			"\"--scan=C:\\Program Files\\\\\""
		);
		assert_eq!(line(&["a b", "c"]), "\"a b\" c");
	}

	#[test]
	fn escapes_quotes_and_the_backslashes_before_them() {
		assert_eq!(line(&["say \"hi\""]), "\"say \\\"hi\\\"\"");
		assert_eq!(line(&["a\\\"b"]), "\"a\\\\\\\"b\"");
	}

	#[test]
	fn quotes_an_empty_argument() {
		assert_eq!(line(&["", "x"]), "\"\" x");
	}
}
