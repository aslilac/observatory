// observatory-scan: scan a path and emit a ScanResult as JSON on stdout.
// Timing + counts always go to stderr.
//
// usage:
//   observatory-scan [--bench] [--perf] <path>
//
//   --bench   suppress JSON output (timing only — useful for benchmarking)
//   --perf    build the per-directory flame-graph perf tree and include
//             it in the output. Adds a few % overhead from the extra
//             Instant::now() calls per directory.

use observatory_scan::{ScanConfig, scan};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

const USAGE: &str = "usage: observatory-scan [--bench] [--perf] <path>";

struct Args {
	path: PathBuf,
	bench: bool,
	perf: bool,
}

fn parse_args() -> Result<Args, String> {
	let mut bench = false;
	let mut perf = false;
	let mut positional: Option<PathBuf> = None;
	for arg in std::env::args().skip(1) {
		match arg.as_str() {
			"--bench" => bench = true,
			"--perf" => perf = true,
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
	Ok(Args { path, bench, perf })
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
	let result = match scan(&args.path, ScanConfig { perf: args.perf }) {
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
		result.errors.len(),
	);

	if args.bench {
		return ExitCode::SUCCESS;
	}

	let stdout = std::io::stdout().lock();
	if let Err(e) = serde_json::to_writer(stdout, &result) {
		eprintln!("serialize failed: {e}");
		return ExitCode::FAILURE;
	}
	let total_ms = start.elapsed().as_millis();
	eprintln!("[perf:total] {total_ms}ms (scan + serialize)");

	ExitCode::SUCCESS
}
