// Tries the updater by hand, against the real bucket or a feed of your own:
//
//     cargo run -p observatory-core --example update -- 1.0.0
//     OBSERVATORY_UPDATE_FEED=http://localhost:8000/latest.json \
//         cargo run -p observatory-core --example update -- 1.0.0
//
// It says what a copy of that version would find. On macOS, with an app and
// a team after the version, it also downloads the release and checks it as
// that app would, without putting it anywhere:
//
//     … --example update -- 1.0.0 /Applications/Observatory.app N52FGD7JD4

use observatory_core::updates;

fn main() {
	let mut args = std::env::args().skip(1);
	let current = args.next().unwrap_or_else(|| "0.0.0".to_string());
	let Some(release) = updates::check(&current, updates::fetch) else {
		println!("nothing newer than {current}");
		return;
	};
	println!("version {} is out: {}", release.version, release.page);
	match &release.download {
		Some(download) => println!("to install: {download}"),
		None => println!("nothing to install by itself here"),
	}

	#[cfg(target_os = "macos")]
	if let (Some(app), Some(team)) = (args.next(), args.next()) {
		let installed = updates::Installed {
			app: app.into(),
			team,
		};
		match updates::stage(&release, &installed) {
			Ok(staged) => println!("ready: {staged:?}"),
			Err(why) => println!("not installable: {why}"),
		}
	}
}
