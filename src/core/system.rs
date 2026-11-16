// What the app is running on, as it's said in the About window and a bug
// report: "macOS 26.1", "Windows 11 (10.0.26100)", "Fedora Linux 42".

/// The operating system and its version.
pub fn describe_system() -> String {
	#[cfg(target_os = "macos")]
	{
		match macos_version() {
			Some(version) => format!("macOS {version}"),
			None => "macOS".to_string(),
		}
	}
	#[cfg(windows)]
	{
		match windows_version() {
			// Windows 11 still calls itself 10.0, from build 22000 on.
			Some((major, minor, build)) if major == 10 => format!(
				"Windows {} ({major}.{minor}.{build})",
				if build >= 22000 { 11 } else { 10 }
			),
			Some((major, minor, build)) => format!("Windows ({major}.{minor}.{build})"),
			None => "Windows".to_string(),
		}
	}
	#[cfg(all(unix, not(target_os = "macos")))]
	{
		// A Flatpak's /etc/os-release is its runtime's; the host's is here.
		let files: &[&str] = if std::path::Path::new("/.flatpak-info").exists() {
			&["/run/host/os-release"]
		} else {
			&["/etc/os-release", "/usr/lib/os-release"]
		};
		files
			.iter()
			.find_map(|file| std::fs::read_to_string(file).ok())
			.and_then(|release| distribution(&release))
			.unwrap_or_else(|| "Linux".to_string())
	}
}

/// How this copy of the app got onto the machine, where there's more than
/// one way: from the Microsoft Store, as a package installed by hand (an
/// MSIX), or as a bare program on Windows, as a Flatpak or a bare program
/// on Linux, and as an app on macOS. It says
/// nothing of how the copy is signed. `development` is for a build that
/// isn't for release, wherever it's run from.
pub fn describe_installation(development: bool) -> &'static str {
	if development {
		return "Development";
	}
	#[cfg(target_os = "macos")]
	{
		let bundled = std::env::current_exe()
			.is_ok_and(|exe| exe.to_string_lossy().contains(".app/Contents/MacOS/"));
		if bundled { "App" } else { "Portable" }
	}
	#[cfg(windows)]
	{
		match windows_package_origin() {
			None => "Portable",
			Some(PACKAGE_ORIGIN_STORE) => "Microsoft Store",
			Some(_) => "MSIX",
		}
	}
	#[cfg(all(unix, not(target_os = "macos")))]
	{
		if std::path::Path::new("/.flatpak-info").exists() {
			"Flatpak"
		} else {
			"Portable"
		}
	}
}

// Windows' `PackageOrigin_Store`: a package the Store installed.
#[cfg(windows)]
const PACKAGE_ORIGIN_STORE: u32 = 3;

// Where the package the app is running as (an MSIX) came from, as Windows'
// `PackageOrigin` has it: the Store, or anything else for one somebody
// installed themselves (0 if Windows won't say). None when the app isn't
// running as a package at all: only a packaged app has a package name to
// ask for.
#[cfg(windows)]
fn windows_package_origin() -> Option<u32> {
	const APPMODEL_ERROR_NO_PACKAGE: i32 = 15700;
	#[link(name = "kernel32")]
	unsafe extern "system" {
		fn GetCurrentPackageFullName(length: *mut u32, name: *mut u16) -> i32;
		fn GetStagedPackageOrigin(name: *const u16, origin: *mut u32) -> i32;
	}
	let mut length = 0u32;
	// SAFETY: with no buffer and a length of zero, the call only says
	// whether there's a name and how long it is.
	let status = unsafe { GetCurrentPackageFullName(&mut length, std::ptr::null_mut()) };
	if status == APPMODEL_ERROR_NO_PACKAGE {
		return None;
	}
	let mut name = vec![0u16; length as usize + 1];
	let mut origin = 0u32;
	// SAFETY: `name` is as long as the call said the name is, and a zero
	// longer, so it's a string with an end whatever comes back, and
	// `origin` is somewhere to put the answer.
	unsafe {
		if GetCurrentPackageFullName(&mut length, name.as_mut_ptr()) == 0 {
			GetStagedPackageOrigin(name.as_ptr(), &mut origin);
		}
	}
	Some(origin)
}

/// The processor the app was built for, as it's usually written: "arm64",
/// "x64".
pub fn describe_architecture() -> &'static str {
	match std::env::consts::ARCH {
		"aarch64" => "arm64",
		"x86_64" => "x64",
		other => other,
	}
}

// What macOS says its version is, where `sw_vers` reads it from.
#[cfg(target_os = "macos")]
fn macos_version() -> Option<String> {
	let plist = std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist").ok()?;
	let after = plist.split("<key>ProductVersion</key>").nth(1)?;
	let version = after.split("<string>").nth(1)?.split("</string>").next()?;
	Some(version.trim().to_string())
}

// Windows' real version, which the usual calls lie about to an app that
// doesn't say in its manifest that it knows of the Windows it's on.
#[cfg(windows)]
fn windows_version() -> Option<(u32, u32, u32)> {
	#[repr(C)]
	struct VersionInfo {
		size: u32,
		major: u32,
		minor: u32,
		build: u32,
		platform: u32,
		service_pack: [u16; 128],
	}
	#[link(name = "ntdll")]
	unsafe extern "system" {
		fn RtlGetVersion(info: *mut VersionInfo) -> i32;
	}
	let mut info = VersionInfo {
		size: std::mem::size_of::<VersionInfo>() as u32,
		major: 0,
		minor: 0,
		build: 0,
		platform: 0,
		service_pack: [0; 128],
	};
	// SAFETY: `info` is the struct the call fills in, with its size set.
	let status = unsafe { RtlGetVersion(&mut info) };
	(status == 0).then_some((info.major, info.minor, info.build))
}

// The fields of an os-release file: `KEY=value` a line, the value maybe in
// quotes.
fn os_release_field(release: &str, key: &str) -> Option<String> {
	release.lines().find_map(|line| {
		let value = line.trim().strip_prefix(key)?.strip_prefix('=')?.trim();
		let value = match value.as_bytes() {
			[b'"', .., b'"'] | [b'\'', .., b'\''] => &value[1..value.len() - 1],
			_ => value,
		};
		// Inside double quotes, a backslash keeps the next character.
		let mut unescaped = String::with_capacity(value.len());
		let mut chars = value.chars();
		while let Some(c) = chars.next() {
			match c {
				'\\' => unescaped.extend(chars.next()),
				c => unescaped.push(c),
			}
		}
		(!unescaped.is_empty()).then_some(unescaped)
	})
}

/// Which Linux this is, from its os-release file: the distribution's name and
/// version ("Fedora Linux 42"). PRETTY_NAME says too much on some and too
/// little on others, so it's only what a distribution with no version (a
/// rolling release) is called.
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn distribution(release: &str) -> Option<String> {
	let name = os_release_field(release, "NAME");
	match (&name, os_release_field(release, "VERSION_ID")) {
		(Some(name), Some(version)) => Some(format!("{name} {version}")),
		_ => os_release_field(release, "PRETTY_NAME").or(name),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_distribution_is_its_name_and_version() {
		let fedora = "NAME=\"Fedora Linux\"\nVERSION=\"42 (Workstation Edition)\"\nID=fedora\n\
			VERSION_ID=42\nPRETTY_NAME=\"Fedora Linux 42 (Workstation Edition)\"\n";
		assert_eq!(distribution(fedora).as_deref(), Some("Fedora Linux 42"));
		let ubuntu = "PRETTY_NAME=\"Ubuntu 24.04.3 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\n";
		assert_eq!(distribution(ubuntu).as_deref(), Some("Ubuntu 24.04"));
		// NAME_SOMETHING isn't NAME.
		let debian = "PRETTY_NAME=\"Debian GNU/Linux 13 (trixie)\"\nVERSION_CODENAME=trixie\n\
			NAME='Debian GNU/Linux'\nVERSION_ID=\"13\"\n";
		assert_eq!(distribution(debian).as_deref(), Some("Debian GNU/Linux 13"));
	}

	#[test]
	fn a_rolling_release_is_what_it_calls_itself() {
		let arch = "NAME=\"Arch Linux\"\nPRETTY_NAME=\"Arch Linux\"\nID=arch\nBUILD_ID=rolling\n";
		assert_eq!(distribution(arch).as_deref(), Some("Arch Linux"));
		assert_eq!(distribution("NAME=Void\n").as_deref(), Some("Void"));
		assert_eq!(distribution("ID=mystery\n"), None);
		assert_eq!(
			distribution("PRETTY_NAME=\"Some \\\"Quoted\\\" OS\"\n").as_deref(),
			Some("Some \"Quoted\" OS")
		);
	}

	#[test]
	fn this_system_has_a_name() {
		assert!(!describe_system().is_empty());
		#[cfg(target_os = "macos")]
		assert!(
			describe_system().starts_with("macOS 1") || describe_system().starts_with("macOS 2")
		);
	}
}
