use crate::drives::Drive;
use chrono::{Datelike, Local, TimeZone};

const SUFFIXES: [&str; 6] = ["bytes", "KB", "MB", "GB", "TB", "PB"];

// Sizes are counted the way the OS's own file manager counts them: in
// thousands on macOS, in 1024s everywhere else.
const BASE: f64 = if cfg!(target_os = "macos") {
	1000.0
} else {
	1024.0
};

pub fn readable_size(bytes: u64) -> String {
	let mut size = bytes as f64;
	let mut exp = 0;
	// Make sure we actually have a suffix and check if we need to step to it
	while exp + 1 < SUFFIXES.len() && size >= 1000.0 {
		size /= BASE;
		exp += 1;
	}
	format!("{} {}", three_digits(size), SUFFIXES[exp])
}

// Whole numbers as they are, anything else to three significant digits.
fn three_digits(size: f64) -> String {
	if size.trunc() == size {
		format!("{size}")
	} else if size >= 100.0 {
		format!("{size:.0}")
	} else if size >= 10.0 {
		format!("{size:.1}")
	} else {
		format!("{size:.2}")
	}
}

// A disk's capacity, rounded the way disks are sold: "2 TB" for 1.995 TB,
// "1.5 TB", "256 GB". Coarser than readable_size, which is for amounts that
// move.
pub fn rounded_size(bytes: u64) -> String {
	let mut size = bytes as f64;
	let mut exp = 0;
	// 999.6 GB would round up to "1000 GB".
	while exp + 1 < SUFFIXES.len() && size >= 999.5 {
		size /= BASE;
		exp += 1;
	}
	let rounded = if size < 9.95 {
		(size * 10.0).round() / 10.0
	} else {
		size.round()
	};
	format!("{rounded} {}", SUFFIXES[exp])
}

// What a drive is, for the line under its name: "2 TB encrypted startup
// disk", "Pecha – SMB network share".
pub fn describe_drive(drive: &Drive) -> String {
	if drive.network {
		let share = match &drive.protocol {
			Some(protocol) => format!("{protocol} network share"),
			None => "Network share".to_string(),
		};
		return match &drive.server {
			Some(server) => format!("{server} – {share}"),
			None => share,
		};
	}
	let capacity = drive
		.usage
		.filter(|usage| usage.total > 0)
		.map(|usage| rounded_size(usage.total));
	let words = [
		capacity.as_deref(),
		drive.encrypted.then_some("encrypted"),
		Some(if drive.startup {
			"startup"
		} else if drive.external {
			"external"
		} else {
			"internal"
		}),
		Some("disk"),
	];
	let text = words.into_iter().flatten().collect::<Vec<_>>().join(" ");
	let mut chars = text.chars();
	match chars.next() {
		Some(first) => first.to_uppercase().chain(chars).collect(),
		None => text,
	}
}

const MINUTE: u64 = 60_000;
const HOUR: u64 = 60 * MINUTE;
const DAY: u64 = 24 * HOUR;

// Compact human-friendly mtime label: "5m ago", "3h ago", "2d ago" for
// recent activity, "Mar 5" for this year, "Mar 5, 2024" for older. Both
// times are milliseconds since 1970.
pub fn readable_date(epoch_ms: u64, now_ms: u64) -> String {
	if epoch_ms == 0 {
		return "—".to_string();
	}
	let Some(delta) = now_ms.checked_sub(epoch_ms) else {
		return "just now".to_string();
	};
	if delta < MINUTE {
		return "just now".to_string();
	}
	if delta < HOUR {
		return format!("{}m ago", delta / MINUTE);
	}
	if delta < DAY {
		return format!("{}h ago", delta / HOUR);
	}
	if delta < 14 * DAY {
		return format!("{}d ago", delta / DAY);
	}
	let (Some(date), Some(now)) = (local(epoch_ms), local(now_ms)) else {
		return "—".to_string();
	};
	if date.year() == now.year() {
		date.format("%b %-d").to_string()
	} else {
		date.format("%b %-d, %Y").to_string()
	}
}

/// The whole date and time, for a tooltip.
pub fn full_date(epoch_ms: u64) -> String {
	local(epoch_ms)
		.map(|date| date.format("%b %-d, %Y, %-I:%M %p").to_string())
		.unwrap_or_default()
}

fn local(epoch_ms: u64) -> Option<chrono::DateTime<Local>> {
	Local
		.timestamp_millis_opt(i64::try_from(epoch_ms).ok()?)
		.single()
}

pub fn now_ms() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map_or(0, |since| since.as_millis() as u64)
}

/// 1234567 as "1,234,567".
pub fn grouped(n: u64) -> String {
	let digits = n.to_string();
	let mut out = String::with_capacity(digits.len() + digits.len() / 3);
	for (i, digit) in digits.chars().enumerate() {
		if i > 0 && (digits.len() - i).is_multiple_of(3) {
			out.push(',');
		}
		out.push(digit);
	}
	out
}

/// "1 item", "1,234 items".
pub fn plural(count: u64, noun: &str) -> String {
	format!(
		"{} {noun}{}",
		grouped(count),
		if count == 1 { "" } else { "s" }
	)
}

/// A count that keeps moving, short enough to read as it does: "12.3k",
/// "4.5M".
pub fn compact_number(n: u64) -> String {
	if n >= 1_000_000 {
		format!("{:.1}M", n as f64 / 1_000_000.0)
	} else if n >= 1000 {
		format!("{:.1}k", n as f64 / 1000.0)
	} else {
		grouped(n)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sizes() {
		assert_eq!(readable_size(0), "0 bytes");
		assert_eq!(readable_size(999), "999 bytes");
		if cfg!(target_os = "macos") {
			assert_eq!(readable_size(1000), "1 KB");
			assert_eq!(readable_size(1_500_000), "1.50 MB");
			assert_eq!(readable_size(12_340_000_000), "12.3 GB");
			assert_eq!(readable_size(123_400_000_000), "123 GB");
			assert_eq!(rounded_size(1_995_000_000_000), "2 TB");
			assert_eq!(rounded_size(1_500_000_000_000), "1.5 TB");
			assert_eq!(rounded_size(256_000_000_000), "256 GB");
			assert_eq!(rounded_size(999_600_000_000), "1 TB");
		}
	}

	#[test]
	fn dates() {
		let now = 1_700_000_000_000;
		assert_eq!(readable_date(0, now), "—");
		assert_eq!(readable_date(now + 5, now), "just now");
		assert_eq!(readable_date(now - 5 * MINUTE, now), "5m ago");
		assert_eq!(readable_date(now - 3 * HOUR, now), "3h ago");
		assert_eq!(readable_date(now - 2 * DAY, now), "2d ago");
	}

	#[test]
	fn counts() {
		assert_eq!(grouped(999), "999");
		assert_eq!(grouped(1000), "1,000");
		assert_eq!(grouped(1_234_567), "1,234,567");
		assert_eq!(plural(1, "item"), "1 item");
		assert_eq!(plural(2000, "item"), "2,000 items");
		assert_eq!(compact_number(12_345), "12.3k");
	}
}
