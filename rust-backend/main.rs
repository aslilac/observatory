// observatory-scan: scan a path and emit a VFS tree as JSON to stdout.
// Timing + counts go to stderr so you can redirect stdout to /dev/null
// and read just the perf line, or pipe the JSON straight into jq.

use observatory_scan::scan;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

const USAGE: &str = "usage: observatory-scan [--bench] <path>";

struct Args {
	path: PathBuf,
	bench: bool,
}

fn parse_args() -> Result<Args, String> {
	let mut bench = false;
	let mut positional: Option<PathBuf> = None;
	for arg in std::env::args().skip(1) {
		match arg.as_str() {
			"--bench" => bench = true,
			"-h" | "--help" => return Err(USAGE.into()),
			s if s.starts_with('-') => return Err(format!("unknown flag: {s}\n{USAGE}")),
			s => {
				if positional.is_some() {
					return Err(format!("expected one path argument\n{USAGE}"));
				}
				positional = Some(PathBuf::from(s));
			}
		}
	}
	let path = positional.ok_or_else(|| USAGE.to_string())?;
	Ok(Args { path, bench })
}

fn main() -> ExitCode {
	let args = match parse_args() {
		Ok(a) => a,
		Err(msg) => {
			eprintln!("{msg}");
			return ExitCode::from(2);
		}
	};

	let start = Instant::now();
	let result = match scan(&args.path) {
		Ok(r) => r,
		Err(e) => {
			eprintln!("scan failed: {e}");
			return ExitCode::FAILURE;
		}
	};
	let scan_ms = start.elapsed().as_millis();

	let c = result.counts;
	eprintln!(
		"[perf:scan] {} {}ms · {} entries ({} files, {} dirs, {} symlinks, {} other; {} errors)",
		args.path.display(),
		scan_ms,
		c.total_entries(),
		c.files,
		c.directories,
		c.symlinks,
		c.misc,
		c.errors,
	);

	if args.bench {
		return ExitCode::SUCCESS;
	}

	// Stream JSON directly to stdout — no intermediate string allocation.
	let stdout = std::io::stdout().lock();
	if let Err(e) = serde_json::to_writer(stdout, &result.root) {
		eprintln!("serialize failed: {e}");
		return ExitCode::FAILURE;
	}
	let total_ms = start.elapsed().as_millis();
	eprintln!("[perf:total] {} ms (scan + serialize)", total_ms);

	ExitCode::SUCCESS
}
