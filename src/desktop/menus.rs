// The application menu, the keys, and what each does. The actions are
// handled app-wide rather than by whatever has the focus, since there's one
// window and they're all about it.

use crate::workspace::Workspace;
use gpui::{
	Action, App, ClipboardItem, Context, KeyBinding, Menu, MenuItem, Window, WindowHandle, actions,
};
use observatory_core::paths::basename;
use observatory_core::scans::FAKE;
use observatory_core::store::RecentScan;
use observatory_core::system;
use std::path::Path;

actions!(
	observatory,
	[
		About,
		OpenFolder,
		Rescan,
		Reveal,
		CopyPath,
		Find,
		ToggleCleanup,
		ToggleDark,
		ToggleFullScreen,
		Back,
		Forward,
		Home,
		Escape,
		SuggestPrevious,
		SuggestNext,
		SuggestPick,
		PastePath,
		VisitGitHub,
		ReportIssue,
		Minimize,
		Zoom,
		CloseWindow,
		Hide,
		HideOthers,
		ShowAll,
		Quit,
	]
);

/// File → Open Recent's items: scan (or show) the folder at `path`.
#[derive(Clone, PartialEq, Action)]
#[action(namespace = observatory, no_json)]
pub struct OpenRecent {
	pub path: String,
}

pub const REPOSITORY: &str = "https://github.com/aslilac/observatory";

pub const REVEAL: &str = if cfg!(target_os = "macos") {
	"Reveal in Finder"
} else {
	"Show in Folder"
};

/// The menu bar: macOS's own, and the one the title bar draws elsewhere.
pub fn app_menus(recents: &[RecentScan], dark: bool) -> Vec<Menu> {
	let mut menus = Vec::new();
	if cfg!(target_os = "macos") {
		menus.push(Menu {
			name: "Observatory".into(),
			items: vec![
				MenuItem::action("About Observatory", About),
				MenuItem::separator(),
				MenuItem::os_submenu("Services", gpui::SystemMenuType::Services),
				MenuItem::separator(),
				MenuItem::action("Hide Observatory", Hide),
				MenuItem::action("Hide Others", HideOthers),
				MenuItem::action("Show All", ShowAll),
				MenuItem::separator(),
				MenuItem::action("Quit Observatory", Quit),
			],
		});
	}

	let recent: Vec<MenuItem> = recents
		.iter()
		.map(|scan| {
			MenuItem::action(
				basename(&scan.path).to_string(),
				OpenRecent {
					path: scan.path.clone(),
				},
			)
		})
		.collect();
	let mut file = vec![MenuItem::action("Open Folder…", OpenFolder)];
	if !recent.is_empty() {
		file.push(MenuItem::submenu(Menu {
			name: "Open Recent".into(),
			items: recent,
		}));
	}
	file.extend([
		MenuItem::separator(),
		MenuItem::action("Rescan", Rescan),
		MenuItem::action(REVEAL, Reveal),
	]);
	if !cfg!(target_os = "macos") {
		file.extend([MenuItem::separator(), MenuItem::action("Quit", Quit)]);
	}
	menus.push(Menu {
		name: "File".into(),
		items: file,
	});

	if cfg!(target_os = "macos") {
		// What makes ⌘C and ⌘V work in a text field, on macOS.
		menus.push(Menu {
			name: "Edit".into(),
			items: vec![
				MenuItem::os_action("Cut", crate::text_input::Cut, gpui::OsAction::Cut),
				MenuItem::os_action("Copy", crate::text_input::Copy, gpui::OsAction::Copy),
				MenuItem::os_action("Paste", crate::text_input::Paste, gpui::OsAction::Paste),
				MenuItem::os_action(
					"Select All",
					crate::text_input::SelectAll,
					gpui::OsAction::SelectAll,
				),
			],
		});
	}

	menus.push(Menu {
		name: "View".into(),
		items: vec![
			MenuItem::action("Find…", Find),
			MenuItem::action("Show Cleanup", ToggleCleanup),
			MenuItem::separator(),
			// gpui's menus have no checkmarks, so the item says which way
			// it goes.
			MenuItem::action(
				if dark {
					"Switch to Light Mode"
				} else {
					"Switch to Dark Mode"
				},
				ToggleDark,
			),
			MenuItem::separator(),
			MenuItem::action("Toggle Full Screen", ToggleFullScreen),
		],
	});
	menus.push(Menu {
		name: "Go".into(),
		items: vec![
			MenuItem::action("Back", Back),
			MenuItem::action("Forward", Forward),
			MenuItem::separator(),
			MenuItem::action("Disks and Folders", Home),
		],
	});
	if cfg!(target_os = "macos") {
		menus.push(Menu {
			name: "Window".into(),
			items: vec![
				MenuItem::action("Minimize", Minimize),
				MenuItem::action("Zoom", Zoom),
				MenuItem::separator(),
				MenuItem::action("Close Window", CloseWindow),
			],
		});
	}
	let mut help = vec![
		MenuItem::action("Visit GitHub", VisitGitHub),
		MenuItem::action("Report an Issue", ReportIssue),
	];
	if !cfg!(target_os = "macos") {
		help.extend([
			MenuItem::separator(),
			MenuItem::action("About Observatory", About),
		]);
	}
	menus.push(Menu {
		name: "Help".into(),
		items: help,
	});
	menus
}

pub fn bind_keys(cx: &mut App) {
	#[cfg(target_os = "macos")]
	cx.bind_keys([
		KeyBinding::new("cmd-o", OpenFolder, None),
		KeyBinding::new("cmd-r", Rescan, None),
		KeyBinding::new("cmd-f", Find, None),
		KeyBinding::new("cmd-[", Back, None),
		KeyBinding::new("cmd-]", Forward, None),
		KeyBinding::new("cmd-shift-h", Home, None),
		KeyBinding::new("cmd-v", PastePath, None),
		KeyBinding::new("ctrl-cmd-f", ToggleFullScreen, None),
		KeyBinding::new("cmd-m", Minimize, None),
		KeyBinding::new("cmd-w", CloseWindow, None),
		KeyBinding::new("cmd-h", Hide, None),
		KeyBinding::new("alt-cmd-h", HideOthers, None),
		KeyBinding::new("cmd-q", Quit, None),
	]);
	#[cfg(not(target_os = "macos"))]
	cx.bind_keys([
		KeyBinding::new("ctrl-o", OpenFolder, None),
		KeyBinding::new("ctrl-r", Rescan, None),
		KeyBinding::new("ctrl-f", Find, None),
		KeyBinding::new("alt-left", Back, None),
		KeyBinding::new("alt-right", Forward, None),
		KeyBinding::new("ctrl-shift-h", Home, None),
		KeyBinding::new("ctrl-v", PastePath, None),
		KeyBinding::new("f11", ToggleFullScreen, None),
		KeyBinding::new("ctrl-q", Quit, None),
	]);
	cx.bind_keys([
		KeyBinding::new("escape", Escape, None),
		// In the find field, the arrows and Enter go through what it
		// suggests.
		KeyBinding::new("up", SuggestPrevious, Some("TextInput")),
		KeyBinding::new("down", SuggestNext, Some("TextInput")),
		KeyBinding::new("enter", SuggestPick, Some("TextInput")),
	]);
}

/// Has `window`'s workspace do what each action says.
pub fn register(window: WindowHandle<Workspace>, cx: &mut App) {
	macro_rules! handle {
		($($action:ty => $method:ident),* $(,)?) => {
			$(cx.on_action(move |action: &$action, cx: &mut App| {
				window
					.update(cx, |workspace, window, cx| workspace.$method(action, window, cx))
					.ok();
			});)*
		};
	}
	handle![
		OpenFolder => on_open_folder,
		OpenRecent => on_open_recent,
		Rescan => on_rescan,
		Reveal => on_reveal,
		CopyPath => on_copy_path,
		Find => on_find,
		ToggleCleanup => on_toggle_cleanup,
		ToggleDark => on_toggle_dark,
		ToggleFullScreen => on_toggle_full_screen,
		Back => on_back,
		Forward => on_forward,
		Home => on_home,
		Escape => on_escape,
		SuggestPrevious => on_suggest_previous,
		SuggestNext => on_suggest_next,
		SuggestPick => on_suggest_pick,
		PastePath => on_paste_path,
	];
	// The Window menu's are about whichever window is in front, which may be
	// the About window.
	fn in_front(cx: &mut App, act: impl FnOnce(&mut Window)) {
		if let Some(window) = cx.active_window() {
			window.update(cx, |_, window, _| act(window)).ok();
		}
	}
	cx.on_action(|_: &Minimize, cx| in_front(cx, |window| window.minimize_window()));
	cx.on_action(|_: &Zoom, cx| in_front(cx, |window| window.zoom_window()));
	cx.on_action(|_: &CloseWindow, cx| in_front(cx, |window| window.remove_window()));
	cx.on_action(|_: &About, cx| crate::about::open(cx));
	cx.on_action(|_: &VisitGitHub, cx| cx.open_url(REPOSITORY));
	cx.on_action(|_: &ReportIssue, cx| cx.open_url(&report_url()));
	cx.on_action(|_: &Hide, cx| cx.hide());
	cx.on_action(|_: &HideOthers, cx| cx.hide_other_apps());
	cx.on_action(|_: &ShowAll, cx| cx.unhide_other_apps());
	cx.on_action(|_: &Quit, cx| cx.quit());
}

/// What this copy is and what it's on, for the About window and a new issue.
/// The version comes first.
pub fn environment() -> Vec<(&'static str, String)> {
	// "1.2.0 (53410bd)", or "(53410bd, modified)" when built from a checkout
	// with changes. The commit's stamped in by build.rs.
	let version = env!("CARGO_PKG_VERSION");
	let version = match env!("OBSERVATORY_COMMIT").split_once('-') {
		_ if env!("OBSERVATORY_COMMIT").is_empty() => version.to_string(),
		Some((commit, _)) => format!("{version} ({}, modified)", &commit[..commit.len().min(7)]),
		None => {
			let commit = env!("OBSERVATORY_COMMIT");
			format!("{version} ({})", &commit[..commit.len().min(7)])
		}
	};
	vec![
		("Version", version),
		(
			"Installation",
			system::describe_installation(cfg!(debug_assertions)).to_string(),
		),
		("System", system::describe_system()),
		("Architecture", system::describe_architecture().to_string()),
	]
}

// A new issue, with a table of what this copy is and what it's on under
// where the report goes.
fn report_url() -> String {
	let mut body = String::from("\n\n|  |  |\n|---|---|\n");
	for (label, value) in environment() {
		body.push_str(&format!("| {label} | {value} |\n"));
	}
	// Everything but letters, digits, and the few marks a URL leaves alone.
	let mut query = String::new();
	for byte in body.bytes() {
		match byte {
			b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
				query.push(byte as char)
			}
			byte => query.push_str(&format!("%{byte:02X}")),
		}
	}
	format!("{REPOSITORY}/issues/new?body={query}")
}

type Cx<'a> = Context<'a, Workspace>;

impl Workspace {
	// The folder the menu's items are about: the one being looked at.
	fn current_path(&self) -> Option<String> {
		let place = self.nav.current();
		let root = place.inspecting.as_deref()?;
		if root.starts_with(FAKE) {
			return None;
		}
		Some(self.path_of(root, &place.cursor))
	}

	fn on_open_folder(&mut self, _: &OpenFolder, window: &mut Window, cx: &mut Cx) {
		self.choose_folder(window, cx);
	}

	fn on_open_recent(&mut self, action: &OpenRecent, window: &mut Window, cx: &mut Cx) {
		self.open(&action.path, window, cx);
	}

	fn on_rescan(&mut self, _: &Rescan, window: &mut Window, cx: &mut Cx) {
		if let Some(path) = self.nav.current().inspecting.clone() {
			self.rescan(&path, window, cx);
		}
	}

	fn on_reveal(&mut self, _: &Reveal, _: &mut Window, cx: &mut Cx) {
		if let Some(path) = self.current_path() {
			cx.reveal_path(Path::new(&path));
		}
	}

	fn on_copy_path(&mut self, _: &CopyPath, _: &mut Window, cx: &mut Cx) {
		if let Some(path) = self.current_path() {
			cx.write_to_clipboard(ClipboardItem::new_string(path));
		}
	}

	fn on_find(&mut self, _: &Find, window: &mut Window, cx: &mut Cx) {
		if self.inspecting().is_some() {
			let focus = gpui::Focusable::focus_handle(self.find_input.read(cx), cx);
			window.focus(&focus);
		}
	}

	fn on_toggle_cleanup(&mut self, _: &ToggleCleanup, _: &mut Window, cx: &mut Cx) {
		self.cleanup_open = !self.cleanup_open;
		cx.notify();
	}

	fn on_toggle_dark(&mut self, _: &ToggleDark, _: &mut Window, cx: &mut Cx) {
		self.toggle_dark(cx);
	}

	fn on_toggle_full_screen(&mut self, _: &ToggleFullScreen, window: &mut Window, _: &mut Cx) {
		window.toggle_fullscreen();
	}

	fn on_back(&mut self, _: &Back, window: &mut Window, cx: &mut Cx) {
		self.go_back(window, cx);
	}

	fn on_forward(&mut self, _: &Forward, window: &mut Window, cx: &mut Cx) {
		self.go_forward(window, cx);
	}

	fn on_home(&mut self, _: &Home, window: &mut Window, cx: &mut Cx) {
		self.go_home(window, cx);
	}

	fn on_escape(&mut self, _: &Escape, window: &mut Window, cx: &mut Cx) {
		self.escape(window, cx);
	}

	fn on_suggest_previous(&mut self, _: &SuggestPrevious, _: &mut Window, cx: &mut Cx) {
		self.move_suggestion(-1, cx);
	}

	fn on_suggest_next(&mut self, _: &SuggestNext, _: &mut Window, cx: &mut Cx) {
		self.move_suggestion(1, cx);
	}

	fn on_suggest_pick(&mut self, _: &SuggestPick, window: &mut Window, cx: &mut Cx) {
		self.pick_suggestion(self.suggestion, window, cx);
	}

	fn on_paste_path(&mut self, _: &PastePath, _: &mut Window, cx: &mut Cx) {
		if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
			self.pasted(&text, cx);
		}
	}
}
