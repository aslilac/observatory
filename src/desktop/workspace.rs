// The window's one view: what the app knows wherever the user is (the scans,
// the store, the theme, where they've been), the screen they're on, and
// what's open over the window. What a screen knows is the screen's (`Screen`,
// and what's in it), so it's only there while that screen is. The screens are
// drawn by `impl Workspace` blocks in the files named for them; what's here
// is which one is showing, and what changes that.

use crate::cleanup::Deletion;
use crate::find::Field;
use crate::inspect::Inspect;
use crate::palette::Palette;
use crate::popup::{MenuButton, OpenMenu};
use crate::scanning::Scanning;
use crate::sunburst::Pointer;
use crate::updating::Update;
use crate::{menus, prompts::Ask};
use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{App, Context, ExternalPaths, FocusHandle, Focusable, Window, WindowAppearance};
use observatory_core::drives::{Drive, Usage, place_name, read_volume_usage};
use observatory_core::navigation::{Navigation, Place};
use observatory_core::scans::{Change, FAKE, ScanInfo, Scans, Status};
use observatory_core::store::Store;
use observatory_core::{ScanError, access, fake_disk};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// What the window is showing.
pub enum Screen {
	/// The disks and folders there are to scan.
	Menu,
	/// One of the scans.
	Scan(Scan),
}

/// The scan on screen.
pub struct Scan {
	/// Its root.
	pub path: String,
	pub state: ScanState,
}

/// How the scan on screen is doing, and what there is to show of it.
pub enum ScanState {
	Scanning(Scanning),
	/// With why, if the scanner said.
	Failed(Option<ScanError>),
	// Boxed, since there's a good deal more to it than to the others.
	Inspect(Box<Inspect>),
}

impl Screen {
	/// The finished scan on screen, if that's what's on it: its root, and
	/// the folder of it that's showing.
	pub fn inspecting(&self) -> Option<(&str, &Inspect)> {
		match self {
			Screen::Scan(Scan {
				path,
				state: ScanState::Inspect(inspect),
			}) => Some((path.as_str(), &**inspect)),
			_ => None,
		}
	}

	pub fn inspecting_mut(&mut self) -> Option<(&str, &mut Inspect)> {
		match self {
			Screen::Scan(Scan {
				path,
				state: ScanState::Inspect(inspect),
			}) => Some((path.as_str(), &mut **inspect)),
			_ => None,
		}
	}
}

pub struct Workspace {
	pub focus: FocusHandle,
	pub scans: Scans,
	pub store: Store,
	pub palette: Palette,
	pub nav: Navigation,
	pub drives: Vec<Drive>,
	pub scan_list: Vec<ScanInfo>,
	// How full the volume each recent folder is on is.
	pub recent_usage: HashMap<String, Usage>,
	// The clock the sunburst's transitions run on.
	pub epoch: Instant,

	// Where the user is (`nav`) and how that scan is doing, as what there is
	// to show of it. `sync` keeps it so.
	pub screen: Screen,

	// What's open over the window, whatever the screen.
	//
	// A deletion carries on while the user's elsewhere, though it only shows
	// over the scan it's of.
	pub deletion: Option<Deletion>,
	pub ask: Option<Ask>,
	// The one menu that's open, and which of the things a menu hangs from
	// the pointer is over.
	pub menu: Option<OpenMenu>,
	pub menu_hovered: Option<MenuButton>,

	// A newer version than this one, once one's been found.
	pub update: Option<Update>,

	// The edge of the window the pointer is at, where the app resizes its
	// own window (see window_frame.rs).
	pub resize_edge: Option<gpui::ResizeEdge>,
	// The window's frame, as of the last time it was drawn.
	pub frame: crate::window_frame::Frame,
}

impl Focusable for Workspace {
	fn focus_handle(&self, _: &App) -> FocusHandle {
		self.focus.clone()
	}
}

impl Workspace {
	pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
		// The scans say when something's changed from whatever thread it
		// changed on; this brings that to the window's.
		let (changes, mut changed) = mpsc::unbounded();
		let scans = Scans::new(move |change| {
			let _ = changes.unbounded_send(change);
		});
		scans.watch_drives();
		cx.spawn_in(window, async move |this, cx| {
			while let Some(change) = changed.next().await {
				let alive = this.update_in(cx, |this, window, cx| this.changed(change, window, cx));
				if alive.is_err() {
					break;
				}
			}
		})
		.detach();

		let store = Store::open();
		let dark = store.dark().unwrap_or_else(|| is_dark(window.appearance()));
		// Until the user picks a theme, the OS's is followed.
		// On Wayland, gpui calls this while it holds its client state, which
		// setting the menus borrows too, so the change waits for the event loop.
		cx.observe_window_appearance(window, |this, window, cx| {
			if this.store.dark().is_none() {
				let dark = is_dark(window.appearance());
				cx.spawn(async move |this, cx| {
					this.update(cx, |this, cx| this.set_dark(dark, cx)).ok();
				})
				.detach();
			}
		})
		.detach();

		let focus = cx.focus_handle();
		window.focus(&focus);

		let mut this = Self {
			focus,
			drives: scans.drives(),
			scan_list: Vec::new(),
			scans,
			store,
			palette: Palette::named(dark),
			nav: Navigation::starting_at(None),
			recent_usage: HashMap::new(),
			epoch: Instant::now(),
			screen: Screen::Menu,
			deletion: None,
			ask: None,
			menu: None,
			menu_hovered: None,
			update: None,
			resize_edge: None,
			frame: Default::default(),
		};
		this.watch_for_updates(window, cx);
		this.forget_recent_drives(cx);
		this.read_recent_usage(cx);
		this.publish_menus(cx);
		this.sync(window, cx);
		this
	}

	fn changed(&mut self, change: Change, window: &mut Window, cx: &mut Context<Self>) {
		match change {
			Change::Drives => {
				self.drives = self.scans.drives();
				self.forget_recent_drives(cx);
				cx.notify();
			}
			Change::Scans => self.sync(window, cx),
		}
	}

	pub fn scan(&self, path: &str) -> Option<&ScanInfo> {
		self.scan_list.iter().find(|scan| scan.path == path)
	}

	pub fn cursor(&self) -> &[String] {
		&self.nav.current().cursor
	}

	/// Brings the screen in line with where the user is and how the scans
	/// are doing. Called after anything that might have changed either.
	pub fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		self.scan_list = self.scans.list();
		let place = self.nav.current().clone();
		let scan = place
			.inspecting
			.as_deref()
			.and_then(|path| self.scan(path))
			.cloned();
		match scan {
			None => self.show(Screen::Menu, window, cx),
			Some(scan) => match scan.status {
				Status::Building => {
					// One that's already on screen carries on as it was.
					let showing = matches!(
						&self.screen,
						Screen::Scan(Scan { path, state: ScanState::Scanning(_) })
							if *path == scan.path
					);
					if !showing {
						let scanning = Scanning::of(&scan.path, &self.scans, cx);
						let state = ScanState::Scanning(scanning);
						self.show_scan(scan.path, state, window, cx);
					}
				}
				Status::Failed => {
					self.show_scan(scan.path, ScanState::Failed(scan.error), window, cx)
				}
				Status::Complete => self.show_folder(&scan, place.cursor, window, cx),
			},
		}
		window.set_window_title(&self.title());
		cx.notify();
	}

	// Puts another screen up. The one it takes the place of goes, with
	// everything it had.
	fn show(&mut self, screen: Screen, window: &mut Window, cx: &mut Context<Self>) {
		// The find field goes with it: if the keys were going there, they're
		// the window's again.
		if let Some((_, inspect)) = self.screen.inspecting()
			&& inspect.find.input.focus_handle(cx).is_focused(window)
		{
			window.focus(&self.focus);
		}
		self.screen = screen;
	}

	fn show_scan(
		&mut self,
		path: String,
		state: ScanState,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		self.show(Screen::Scan(Scan { path, state }), window, cx);
	}

	// Cuts the slice of `scan` at `cursor`, and shows it: in the scan that's
	// on screen if it's this one, so what's checked and what's being looked
	// for stay while the user goes from folder to folder, and otherwise
	// starting over.
	fn show_folder(
		&mut self,
		scan: &ScanInfo,
		mut cursor: Vec<String>,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let showing = self
			.screen
			.inspecting()
			.filter(|(path, _)| *path == scan.path);
		// It's what's showing already.
		if showing.is_some_and(|(_, inspect)| {
			inspect.revision == scan.revision && inspect.tree.cursor == cursor
		}) {
			return;
		}
		let tree = loop {
			match self.scans.render_tree(&scan.path, &cursor) {
				Some(tree) => break Arc::new(tree),
				// The folder's gone (deleted, or not there in a rescan): its
				// nearest parent that isn't.
				None if !cursor.is_empty() => {
					cursor.pop();
				}
				None => {
					self.show(Screen::Menu, window, cx);
					return;
				}
			}
		};
		if cursor != self.cursor() {
			self.nav.set_cursor(cursor);
		}

		let (palette, now) = (self.palette, self.epoch.elapsed());
		match self
			.screen
			.inspecting_mut()
			.filter(|(path, _)| *path == scan.path)
		{
			Some((root, inspect)) => {
				let same_folder = inspect.tree.cursor == tree.cursor;
				inspect.revision = scan.revision;
				inspect.tree = tree;
				inspect.sunburst.pointer = Pointer::Away;
				inspect.lay_out(root, palette.dark, now, false);
				if same_folder {
					// The same folder of a scan that's changed (something was
					// deleted): what was found is out of date.
					self.run_find(false, cx);
				} else {
					// Each folder starts collapsed again.
					inspect.show_all = false;
				}
			}
			None => {
				let inspect = Inspect::new(tree, scan, &palette, now, window, cx);
				let state = ScanState::Inspect(Box::new(inspect));
				self.show_scan(scan.path.clone(), state, window, cx);
			}
		}
		// What the finders find is counted below the folder that's showing.
		let suggesting = self
			.screen
			.inspecting()
			.is_some_and(|(_, inspect)| matches!(inspect.find.field, Field::Suggesting { .. }));
		if suggesting {
			self.load_summaries(cx);
		}
	}

	/// What the window's called: the OS's title for it, and what the title
	/// bar says.
	pub fn title(&self) -> String {
		let place = self.nav.current();
		let Some(path) = &place.inspecting else {
			return "Observatory".to_string();
		};
		let root = self.root_name(path);
		match place.cursor.last() {
			Some(folder) => format!("{folder} — {root} — Observatory"),
			None => format!("{root} — Observatory"),
		}
	}

	/// What the scan of `path`, the one being looked at, is called: a
	/// drive's name, or the folder's. A scan that's running or has failed is
	/// called what it will be once it's done.
	pub fn root_name(&self, path: &str) -> String {
		match self.screen.inspecting() {
			Some((_, inspect)) => inspect.tree.name.clone(),
			None => place_name(&self.drives, path),
		}
	}

	// Recent folders say how much room is left on their volume. A volume
	// that's gone away can keep statfs waiting, so it's asked off to the
	// side.
	pub fn read_recent_usage(&mut self, cx: &mut Context<Self>) {
		let paths: Vec<String> = self
			.store
			.recent_scans()
			.iter()
			.map(|recent| recent.path.clone())
			.collect();
		cx.spawn(async move |this, cx| {
			let usage = cx
				.background_executor()
				.spawn(async move {
					paths
						.into_iter()
						.filter_map(|path| {
							let usage = read_volume_usage(&path, Duration::from_secs(2))?;
							Some((path, usage))
						})
						.collect::<HashMap<_, _>>()
				})
				.await;
			this.update(cx, |this, cx| {
				this.recent_usage = usage;
				cx.notify();
			})
			.ok();
		})
		.detach();
	}

	pub fn publish_menus(&self, cx: &mut App) {
		cx.set_menus(menus::app_menus(
			self.store.recent_scans(),
			self.palette.dark,
		));
	}

	// Where the user is.

	/// Goes to a scan of `path`, starting one if there isn't one. On macOS
	/// the first scan asks for Full Disk Access first, once.
	pub fn open(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) {
		let scanned = self.scans.get(path).is_some();
		if !scanned
			&& cfg!(target_os = "macos")
			&& !path.starts_with(FAKE)
			&& !self.store.full_disk_access_asked()
			&& !access::has_full_disk_access()
		{
			self.ask = Some(Ask::FullDiskAccess(path.to_string()));
			cx.notify();
			return;
		}
		self.open_now(path, window, cx);
	}

	pub fn open_now(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) {
		if !path.starts_with(FAKE) {
			// A path that's already scanned, or scanning, is left as it is.
			self.scans.start(path);
			// The recents are folders: a disk is in the list of disks.
			if !self.is_drive(path) {
				self.store.push_recent(path);
				self.read_recent_usage(cx);
				self.publish_menus(cx);
			}
		}
		self.nav.inspect(Some(path.to_string()));
		self.sync(window, cx);
	}

	fn is_drive(&self, path: &str) -> bool {
		self.drives.iter().any(|drive| drive.mount_path == path)
	}

	// Takes the disks out of the recents, where an earlier version put them
	// (or where one's been mounted since at a folder that was scanned).
	fn forget_recent_drives(&mut self, cx: &mut Context<Self>) {
		let drives: Vec<String> = self
			.store
			.recent_scans()
			.iter()
			.filter(|recent| self.is_drive(&recent.path))
			.map(|recent| recent.path.clone())
			.collect();
		if drives.is_empty() {
			return;
		}
		for path in &drives {
			self.store.remove_recent(path);
		}
		self.publish_menus(cx);
	}

	pub fn rescan(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) {
		if path.starts_with(FAKE) {
			return;
		}
		self.scans.rescan(path);
		// What's showing of it is of the scan that was.
		if self
			.screen
			.inspecting()
			.is_some_and(|(root, _)| root == path)
		{
			self.show(Screen::Menu, window, cx);
		}
		self.sync(window, cx);
	}

	pub fn load_demo_disk(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let path = match self.scans.get(&format!("{FAKE}demo")) {
			Some(scan) => scan.path,
			None => {
				let Ok(path) =
					self.scans
						.start_fake("demo", &fake_disk::build(), Some(fake_disk::CAPACITY))
				else {
					return;
				};
				path
			}
		};
		self.open_now(&path, window, cx);
	}

	pub fn choose_folder(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
			files: false,
			directories: true,
			multiple: false,
			prompt: Some("Scan".into()),
		});
		cx.spawn_in(window, async move |this, cx| {
			let Ok(Ok(Some(paths))) = chosen.await else {
				return;
			};
			let Some(path) = paths.into_iter().next() else {
				return;
			};
			this.update_in(cx, |this, window, cx| {
				this.open(&path.to_string_lossy(), window, cx)
			})
			.ok();
		})
		.detach();
	}

	/// A folder dropped on the window from outside is one to scan.
	pub fn dropped(&mut self, paths: &ExternalPaths, window: &mut Window, cx: &mut Context<Self>) {
		let Some(path) = paths.paths().iter().find(|path| path.is_dir()) else {
			return;
		};
		self.open(&path.to_string_lossy(), window, cx);
	}

	pub fn set_cursor(&mut self, cursor: Vec<String>, window: &mut Window, cx: &mut Context<Self>) {
		if self.nav.set_cursor(cursor) {
			self.sync(window, cx);
		}
	}

	pub fn enter(&mut self, into: &[String], window: &mut Window, cx: &mut Context<Self>) {
		let mut cursor = self.cursor().to_vec();
		cursor.extend(into.iter().cloned());
		self.set_cursor(cursor, window, cx);
	}

	pub fn up(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let mut cursor = self.cursor().to_vec();
		if cursor.pop().is_some() {
			self.set_cursor(cursor, window, cx);
		}
	}

	pub fn go_home(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if self.nav.inspect(None) {
			self.sync(window, cx);
		}
	}

	pub fn go_back(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if self.nav.back() {
			self.sync(window, cx);
		}
	}

	pub fn go_forward(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if self.nav.forward() {
			self.sync(window, cx);
		}
	}

	pub fn go_to(&mut self, place: Place, window: &mut Window, cx: &mut Context<Self>) {
		if self.nav.navigate(place) {
			self.sync(window, cx);
		}
	}

	// How it looks.

	pub fn set_dark(&mut self, dark: bool, cx: &mut Context<Self>) {
		self.palette = Palette::named(dark);
		let (palette, now) = (self.palette, self.epoch.elapsed());
		if let Some((root, inspect)) = self.screen.inspecting_mut() {
			inspect.find.input.update(cx, |input, _| {
				input.placeholder_color = palette.faint;
			});
			// The wedges' colors are the theme's; they change in place.
			inspect.lay_out(root, dark, now, true);
		}
		self.publish_menus(cx);
		cx.notify();
	}

	pub fn toggle_dark(&mut self, cx: &mut Context<Self>) {
		let dark = !self.palette.dark;
		self.store.set_dark(dark);
		self.set_dark(dark, cx);
	}

	/// Escape: shuts the topmost thing that's open, or failing that clears
	/// what's found, then what's checked.
	pub fn escape(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		cx.notify();
		if self.menu.take().is_some() || self.ask.take().is_some() {
			return;
		}
		if let Some((_, inspect)) = self.screen.inspecting_mut() {
			inspect.escape(&self.focus, window, cx);
		}
	}
}

pub fn is_dark(appearance: WindowAppearance) -> bool {
	matches!(
		appearance,
		WindowAppearance::Dark | WindowAppearance::VibrantDark
	)
}
