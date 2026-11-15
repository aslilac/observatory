// Observatory, drawn with gpui. Everything it knows about disks, scans, and
// the sunburst's shape is `observatory-core`'s; what's here is the window.

mod assets;
mod chrome;
mod cleanup;
mod controls;
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
mod welcome;
mod workspace;

use gpui::{
	App, Application, Bounds, TitlebarOptions, WindowBounds, WindowOptions, point, prelude::*, px,
	size,
};
use workspace::Workspace;

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
			text_input::bind_keys(cx);
			menus::bind_keys(cx);

			let bounds = Bounds::centered(None, size(px(1100.), px(760.)), cx);
			let window = cx
				.open_window(
					WindowOptions {
						window_bounds: Some(WindowBounds::Windowed(bounds)),
						window_min_size: Some(size(px(800.), px(560.))),
						// On macOS the window has one bar, the app's own, with
						// the traffic lights in it.
						titlebar: Some(TitlebarOptions {
							title: Some("Observatory".into()),
							appears_transparent: cfg!(target_os = "macos"),
							traffic_light_position: Some(point(px(12.), px(12.))),
						}),
						..Default::default()
					},
					|window, cx| cx.new(|cx| Workspace::new(window, cx)),
				)
				.expect("the window couldn't be opened");
			menus::register(window, cx);

			// There's one window: the app goes when it does.
			cx.on_window_closed(|cx| {
				if cx.windows().is_empty() {
					cx.quit();
				}
			})
			.detach();

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
