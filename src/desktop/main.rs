// Observatory, drawn with gpui. Everything it knows about disks, scans, and
// the sunburst's shape is `observatory-core`'s; what's here is the window.

// On Windows, a release build is an app with a window, not a program that
// brings a console up behind it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod about;
mod assets;
mod chrome;
mod cleanup;
mod controls;
mod fonts;
mod inspect;
mod issues;
mod lists;
mod menus;
mod palette;
mod popup;
mod prompts;
mod scanning;
mod shapes;
mod sunburst;
mod text_input;
mod updating;
mod welcome;
mod window_frame;
mod workspace;

use gpui::{
	App, Application, Bounds, TitlebarOptions, WindowBounds, WindowDecorations, WindowOptions,
	point, prelude::*, px, size,
};
use workspace::Workspace;

// What the windows say they're of, on Linux: the name of the desktop file,
// which is how a taskbar finds the app's icon (and its name, and that the
// window belongs to its launcher). Without it KDE shows the icon for nothing.
const APP_ID: &str = "ooo.lilac.observatory";

// What the command line asks for: `--demo` for the fake disk, or a folder to
// scan (`--scan=<path>`, or just the path).
enum Start {
	Welcome,
	Demo,
	Scan(String),
}

fn start() -> Start {
	for arg in std::env::args().skip(1) {
		if arg == "--demo" {
			return Start::Demo;
		}
		if let Some(path) = arg.strip_prefix("--scan=") {
			return Start::Scan(path.to_string());
		}
		if !arg.starts_with('-') {
			return Start::Scan(arg);
		}
	}
	Start::Welcome
}

fn main() {
	Application::new()
		.with_assets(assets::Assets)
		.run(|cx: &mut App| {
			fonts::register(cx);
			text_input::bind_keys(cx);
			menus::bind_keys(cx);
			window_frame::follow_button_layout(cx);

			let bounds = Bounds::centered(None, size(px(1100.), px(760.)), cx);
			let window = cx
				.open_window(
					WindowOptions {
						window_bounds: Some(WindowBounds::Windowed(bounds)),
						window_min_size: Some(size(px(800.), px(560.))),
						// The window has one bar, the app's own, with the
						// window's buttons in it (see window_frame.rs).
						titlebar: Some(TitlebarOptions {
							title: Some("Observatory".into()),
							appears_transparent: true,
							traffic_light_position: Some(point(px(12.), px(12.))),
						}),
						window_decorations: Some(WindowDecorations::Client),
						app_id: Some(APP_ID.into()),
						..Default::default()
					},
					|window, cx| cx.new(|cx| Workspace::new(window, cx)),
				)
				.expect("the window couldn't be opened");
			menus::register(window, cx);

			// The app goes when its window does, whether or not the About
			// window is still up.
			cx.on_window_closed(move |cx| {
				if window.update(cx, |_, _, _| ()).is_err() {
					cx.quit();
				}
			})
			.detach();
			if std::env::args().any(|arg| arg == "--about") {
				about::open(cx);
			}

			window
				.update(cx, |workspace, window, cx| match start() {
					Start::Welcome => {}
					Start::Demo => workspace.load_demo_disk(window, cx),
					Start::Scan(path) => {
						// As the user would have picked it: no trailing slash,
						// and absolute.
						let path = std::fs::canonicalize(&path)
							.map(|path| path.to_string_lossy().into_owned())
							.unwrap_or(path);
						workspace.open(&path, window, cx);
					}
				})
				.ok();
			cx.activate(true);
		});
}
