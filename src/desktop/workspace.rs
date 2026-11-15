// The window's one view, and everything it knows: where the user is, what
// that shows, and what's open over it. The screens are drawn by `impl
// Workspace` blocks in the files named for them; what's here is the state
// and what changes it.

use crate::cleanup::Deletion;
use crate::issues::IssuesModal;
use crate::palette::Palette;
use crate::popup::Popup;
use crate::text_input::{self, TextInput};
use crate::updating::Update;
use crate::{menus, prompts::Ask};
use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{
	App, AppContext, Bounds, Context, Entity, ExternalPaths, FocusHandle, Focusable, Pixels, Point,
	Task, Window, WindowAppearance,
};
use observatory_core::drives::{Drive, Usage, place_name, read_volume_usage};
use observatory_core::listing::SortMode;
use observatory_core::navigation::{Navigation, Place};
use observatory_core::paths::join_path;
use observatory_core::reserved::{ReservedGroup, group_reserved};
use observatory_core::scans::{Change, FAKE, Progress, ScanInfo, Scans, Status};
use observatory_core::store::Store;
use observatory_core::sunburst::{Hit, LayoutInput, Sunburst, View, layout_wedges};
use observatory_core::tree::{Item, Node, RenderTree};
use observatory_core::{Finder, Found, Query, Summary, access, color, fake_disk};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ViewMode {
	List,
	Tree,
}

/// What the pointer is over in the sunburst, and where it is.
#[derive(Clone, Copy, PartialEq)]
pub struct Hover {
	pub hit: Hit,
	pub position: Point<Pixels>,
}

/// What the window is showing, going by where the user is and how that
/// scan is doing.
pub enum Screen {
	Welcome,
	Scanning(ScanInfo),
	Failed(ScanInfo),
	Inspect(ScanInfo),
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

	// The folder being inspected: a slice of the scan's tree, and what's
	// worked out from it.
	pub tree: Option<Arc<RenderTree>>,
	// What `tree` is of: the scan, the cursor, and the scan's revision.
	shown: Option<(String, Vec<String>, u64)>,
	pub reserved: Vec<ReservedGroup>,
	pub hues: HashMap<String, f64>,
	pub sunburst: Sunburst,
	// Where the sunburst was last drawn, for finding what the pointer's on.
	pub sunburst_bounds: Bounds<Pixels>,
	pub hover: Option<Hover>,
	pub hover_since: Instant,

	pub mode: ViewMode,
	pub sort: SortMode,
	pub show_all: bool,
	// What's checked, in the order it was.
	pub selection: Vec<Item>,
	// The folder tree: which rows are open (by their path below the cursor),
	// and the children fetched for them.
	pub expanded: HashSet<String>,
	pub branches: HashMap<String, Vec<Arc<Node>>>,

	// Find: what a finder finds, or what has a name, in place of the list
	// while there's a query. It looks in the folder that was showing when
	// the query started, and keeps to it while the user goes through the
	// matches in the sunburst.
	pub find_input: Entity<TextInput>,
	pub finder: Option<Finder>,
	pub find_scope: Option<Vec<String>>,
	pub suggesting: bool,
	pub suggestion: usize,
	pub found: Option<Arc<Found>>,
	pub finding: bool,
	find_generation: u64,
	pub summaries: Option<Arc<Vec<Summary>>>,
	summaries_for: Option<(String, Vec<String>, u64)>,

	pub progress: Option<Progress>,
	polling: Option<Task<()>>,

	// What's open over the window.
	pub cleanup_open: bool,
	pub cleanup_confirming: bool,
	pub deletion: Option<Deletion>,
	pub issues: Option<IssuesModal>,
	pub ask: Option<Ask>,
	pub popup: Option<Popup>,
	// Which of the title bar's menus is open, where there's no native menu
	// bar.
	pub app_menu_open: Option<usize>,
	// And which of their names the pointer is over.
	pub app_menu_hovered: Option<usize>,

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

		let find_input = cx.new(|cx| {
			let mut input = TextInput::new("Find…", cx);
			input.placeholder_color = Palette::named(dark).faint;
			input
		});
		cx.subscribe_in(
			&find_input,
			window,
			|this, _, _: &text_input::Changed, _, cx| this.find_text_changed(cx),
		)
		.detach();
		// Backspace in the empty field takes the finder's chip away.
		cx.subscribe_in(
			&find_input,
			window,
			|this, _, _: &text_input::BackspacedEmpty, _, cx| {
				if this.finder.is_some() {
					this.clear_finder(cx);
				}
			},
		)
		.detach();
		let find_focus = find_input.focus_handle(cx);
		cx.on_focus(&find_focus, window, |this, _, cx| {
			this.suggesting = true;
			this.suggestion = 0;
			this.load_summaries(cx);
			cx.notify();
		})
		.detach();
		cx.on_blur(&find_focus, window, |this, _, cx| {
			this.suggesting = false;
			cx.notify();
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
			tree: None,
			shown: None,
			reserved: Vec::new(),
			hues: HashMap::new(),
			sunburst: Sunburst::new(),
			sunburst_bounds: Bounds::default(),
			hover: None,
			hover_since: Instant::now(),
			mode: ViewMode::List,
			sort: SortMode::Size,
			show_all: false,
			selection: Vec::new(),
			expanded: HashSet::new(),
			branches: HashMap::new(),
			find_input,
			finder: None,
			find_scope: None,
			suggesting: false,
			suggestion: 0,
			found: None,
			finding: false,
			find_generation: 0,
			summaries: None,
			summaries_for: None,
			progress: None,
			polling: None,
			cleanup_open: false,
			cleanup_confirming: false,
			deletion: None,
			issues: None,
			ask: None,
			popup: None,
			app_menu_open: None,
			app_menu_hovered: None,
			update: None,
			resize_edge: None,
			frame: Default::default(),
		};
		this.watch_for_updates(window, cx);
		this.read_recent_usage(cx);
		this.publish_menus(cx);
		this.sync(window, cx);
		this
	}

	fn changed(&mut self, change: Change, window: &mut Window, cx: &mut Context<Self>) {
		match change {
			Change::Drives => {
				self.drives = self.scans.drives();
				cx.notify();
			}
			Change::Scans => self.sync(window, cx),
		}
	}

	pub fn screen(&self) -> Screen {
		let scan = self
			.nav
			.current()
			.inspecting
			.as_deref()
			.and_then(|path| self.scan(path));
		match scan {
			None => Screen::Welcome,
			Some(scan) => match scan.status {
				Status::Building => Screen::Scanning(scan.clone()),
				Status::Failed => Screen::Failed(scan.clone()),
				Status::Complete => Screen::Inspect(scan.clone()),
			},
		}
	}

	pub fn scan(&self, path: &str) -> Option<&ScanInfo> {
		self.scan_list.iter().find(|scan| scan.path == path)
	}

	/// The scan being looked at, if it's finished.
	pub fn inspecting(&self) -> Option<&ScanInfo> {
		let path = self.nav.current().inspecting.as_deref()?;
		self.scan(path)
			.filter(|scan| scan.status == Status::Complete)
	}

	pub fn cursor(&self) -> &[String] {
		&self.nav.current().cursor
	}

	/// Brings what's showing in line with where the user is and how the
	/// scans are doing. Called after anything that might have changed
	/// either.
	pub fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		self.scan_list = self.scans.list();
		let place = self.nav.current().clone();
		let scan = place
			.inspecting
			.as_deref()
			.and_then(|path| self.scan(path))
			.cloned();
		match &scan {
			Some(scan) if scan.status == Status::Complete => {
				let key = (scan.path.clone(), place.cursor.clone(), scan.revision);
				if self.shown.as_ref() != Some(&key) {
					self.show_folder(scan, place.cursor, cx);
				}
			}
			_ => {
				self.tree = None;
				self.shown = None;
				self.hover = None;
				self.sunburst = Sunburst::new();
			}
		}
		match &scan {
			Some(scan) if scan.status == Status::Building => {
				self.poll_progress(scan.path.clone(), cx)
			}
			_ => {
				self.polling = None;
				self.progress = None;
			}
		}
		window.set_window_title(&self.title());
		cx.notify();
	}

	// Cuts the slice of `scan` at `cursor`, and lays the sunburst out for
	// it.
	fn show_folder(&mut self, scan: &ScanInfo, mut cursor: Vec<String>, cx: &mut Context<Self>) {
		let tree = loop {
			match self.scans.render_tree(&scan.path, &cursor) {
				Some(tree) => break tree,
				// The folder's gone (deleted, or not there in a rescan): its
				// nearest parent that isn't.
				None if !cursor.is_empty() => {
					cursor.pop();
				}
				None => {
					self.tree = None;
					self.shown = None;
					return;
				}
			}
		};
		if cursor != self.cursor() {
			self.nav.set_cursor(cursor.clone());
		}

		let before = self.shown.take();
		let same_scan = before.as_ref().is_some_and(|(path, ..)| *path == scan.path);
		let same_folder = same_scan && before.as_ref().is_some_and(|(_, at, _)| *at == cursor);
		if !same_scan {
			// Navigating around inside a scan keeps whatever's checked, so
			// the user can browse for more; a different scan starts over.
			self.selection.clear();
			self.sort = SortMode::Size;
			self.clear_find(cx);
			self.summaries = None;
			self.summaries_for = None;
		}
		if !same_folder {
			// Each folder starts collapsed again.
			self.show_all = false;
			self.expanded.clear();
			self.branches.clear();
		} else {
			// The same folder of a scan that's changed (something was
			// deleted): what was fetched or found is out of date.
			self.branches.clear();
			self.run_find(false, cx);
		}
		self.hover = None;
		self.shown = Some((scan.path.clone(), cursor, scan.revision));
		self.tree = Some(Arc::new(tree));
		self.lay_out(false);
		if self.suggesting {
			self.load_summaries(cx);
		}
	}

	// Works out the sunburst's wedges for `tree`, and has it show them.
	fn lay_out(&mut self, still: bool) {
		let (Some(tree), Some((root, ..))) = (&self.tree, &self.shown) else {
			return;
		};
		self.reserved = group_reserved(&tree.reserved);
		self.hues = tree
			.list
			.iter()
			.map(|file| file.name.clone())
			.zip(color::hues_by_position(
				tree.list.iter().map(|file| file.size),
				tree.position,
				tree.root_size,
			))
			.collect();
		let wedges = layout_wedges(&LayoutInput {
			root,
			cursor: &tree.cursor,
			files: &tree.sunburst,
			capacity: tree.capacity,
			size: tree.size,
			root_size: tree.root_size,
			position: tree.position,
			reserved: &self.reserved,
			dark: self.palette.dark,
		});
		let view = View {
			root: root.clone(),
			cursor: tree.cursor.clone(),
			span: if tree.capacity > 0 {
				tree.size as f64 / tree.capacity as f64
			} else {
				0.0
			},
		};
		self.sunburst
			.show(view, wedges, self.epoch.elapsed(), still);
	}

	fn title(&self) -> String {
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
		match &self.tree {
			Some(tree) => tree.name.clone(),
			None => place_name(&self.drives, path),
		}
	}

	// While a scan's running, how far along it is, four times a second.
	fn poll_progress(&mut self, path: String, cx: &mut Context<Self>) {
		if self.polling.is_some() {
			return;
		}
		self.progress = self.scans.progress(&path);
		self.polling = Some(cx.spawn(async move |this, cx| {
			loop {
				cx.background_executor()
					.timer(Duration::from_millis(250))
					.await;
				let alive = this.update(cx, |this, cx| {
					this.progress = this.scans.progress(&path);
					cx.notify();
				});
				if alive.is_err() {
					break;
				}
			}
		}));
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
			self.store.push_recent(path);
			self.read_recent_usage(cx);
			self.publish_menus(cx);
		}
		self.nav.inspect(Some(path.to_string()));
		self.sync(window, cx);
	}

	pub fn rescan(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) {
		if path.starts_with(FAKE) {
			return;
		}
		self.scans.rescan(path);
		self.shown = None;
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
		self.cleanup_open = false;
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
		self.find_input.update(cx, |input, _| {
			input.placeholder_color = self.palette.faint;
		});
		// The wedges' colors are the theme's; they change in place.
		self.lay_out(true);
		self.publish_menus(cx);
		cx.notify();
	}

	pub fn toggle_dark(&mut self, cx: &mut Context<Self>) {
		let dark = !self.palette.dark;
		self.store.set_dark(dark);
		self.set_dark(dark, cx);
	}

	// What's checked.

	pub fn is_selected(&self, path: &str) -> bool {
		self.selection.iter().any(|item| item.path == path)
	}

	pub fn toggle_selected(&mut self, item: &Item, cx: &mut Context<Self>) {
		match self.selection.iter().position(|it| it.path == item.path) {
			Some(at) => {
				self.selection.remove(at);
			}
			None => self.selection.push(item.clone()),
		}
		cx.notify();
	}

	/// What a drag of `item` carries: everything checked, if it's one of
	/// them, or just it.
	pub fn dragged_with(&self, item: &Item) -> Vec<Item> {
		if self.is_selected(&item.path) {
			self.selection.clone()
		} else {
			vec![item.clone()]
		}
	}

	pub fn move_to_cleanup(&mut self, items: Vec<Item>, cx: &mut Context<Self>) {
		self.store.add_to_cleanup(items);
		cx.notify();
	}

	pub fn move_selected_to_cleanup(&mut self, cx: &mut Context<Self>) {
		let items = std::mem::take(&mut self.selection);
		self.move_to_cleanup(items, cx);
	}

	// The folder tree.

	/// Opens or shuts the row at `key` (its names below the cursor, joined
	/// by slashes), fetching what's in it the first time.
	pub fn toggle_branch(&mut self, key: &str, names: &[String], cx: &mut Context<Self>) {
		if !self.expanded.remove(key) {
			self.expanded.insert(key.to_string());
			if !self.branches.contains_key(key)
				&& let Some((root, cursor, _)) = &self.shown
			{
				let mut below = cursor.clone();
				below.extend(names.iter().cloned());
				let children = self
					.scans
					.render_tree(root, &below)
					.map(|tree| tree.tree)
					.unwrap_or_default();
				self.branches.insert(key.to_string(), children);
			}
		}
		cx.notify();
	}

	// Find.

	pub fn find_text(&self, cx: &App) -> String {
		self.find_input.read(cx).text().trim().to_string()
	}

	/// The folder find looks in: where it started, or where the user is.
	pub fn scope(&self) -> Vec<String> {
		self.find_scope
			.clone()
			.unwrap_or_else(|| self.cursor().to_vec())
	}

	/// Whether there's a query, so its results take the list's place.
	pub fn finding_something(&self, cx: &App) -> bool {
		self.finder.is_some() || !self.find_text(cx).is_empty()
	}

	fn find_text_changed(&mut self, cx: &mut Context<Self>) {
		let text = self.find_text(cx);
		self.suggestion = 0;
		if !text.is_empty() {
			self.finder = None;
			if self.find_scope.is_none() {
				self.find_scope = Some(self.cursor().to_vec());
			}
		} else if self.finder.is_none() {
			self.find_scope = None;
		}
		self.run_find(true, cx);
	}

	pub fn pick_finder(&mut self, finder: Finder, window: &mut Window, cx: &mut Context<Self>) {
		let scope = self.scope();
		self.find_input
			.update(cx, |input, cx| input.set_text("", cx));
		self.finder = Some(finder);
		self.find_scope = Some(scope);
		window.focus(&self.focus);
		self.run_find(false, cx);
	}

	pub fn clear_finder(&mut self, cx: &mut Context<Self>) {
		self.finder = None;
		self.find_scope = None;
		self.run_find(false, cx);
	}

	pub fn clear_find(&mut self, cx: &mut Context<Self>) {
		self.find_input
			.update(cx, |input, cx| input.set_text("", cx));
		self.finder = None;
		self.find_scope = None;
		self.run_find(false, cx);
	}

	// Looks for whatever the query is now, off to the side. A name being
	// typed waits a moment for the next letter (`settle`).
	fn run_find(&mut self, settle: bool, cx: &mut Context<Self>) {
		self.find_generation += 1;
		let generation = self.find_generation;
		let text = self.find_text(cx);
		let query = if !text.is_empty() {
			Query::Name(text)
		} else if let Some(finder) = self.finder {
			Query::Finder(finder)
		} else {
			self.found = None;
			self.finding = false;
			cx.notify();
			return;
		};
		let Some(scan) = self.inspecting() else {
			return;
		};
		let (path, scope) = (scan.path.clone(), self.scope());
		let scans = self.scans.clone();
		let wait = settle && matches!(query, Query::Name(_));
		self.finding = true;
		cx.notify();
		cx.spawn(async move |this, cx| {
			if wait {
				cx.background_executor()
					.timer(Duration::from_millis(180))
					.await;
				let current = this.read_with(cx, |this, _| this.find_generation == generation);
				if !current.unwrap_or(false) {
					return;
				}
			}
			let found = cx
				.background_executor()
				.spawn(async move { scans.find(&path, &scope, &query) })
				.await;
			this.update(cx, |this, cx| {
				if this.find_generation == generation {
					this.found = found.map(Arc::new);
					this.finding = false;
					cx.notify();
				}
			})
			.ok();
		})
		.detach();
	}

	// How much each finder finds below the folder find looks in, for the
	// suggestions.
	pub fn load_summaries(&mut self, cx: &mut Context<Self>) {
		let Some(scan) = self.inspecting() else {
			return;
		};
		let key = (scan.path.clone(), self.scope(), scan.revision);
		if self.summaries_for.as_ref() == Some(&key) {
			return;
		}
		self.summaries_for = Some(key.clone());
		self.summaries = None;
		let scans = self.scans.clone();
		cx.spawn(async move |this, cx| {
			let (path, scope) = (key.0.clone(), key.1.clone());
			let summaries = cx
				.background_executor()
				.spawn(async move { scans.summarize(&path, &scope) })
				.await;
			this.update(cx, |this, cx| {
				if this.summaries_for.as_ref() == Some(&key) {
					this.summaries = summaries.map(Arc::new);
					cx.notify();
				}
			})
			.ok();
		})
		.detach();
	}

	/// The path on disk of `names` below the scan's root.
	pub fn path_of(&self, root: &str, names: &[String]) -> String {
		join_path(root, names)
	}

	/// Escape: shuts the topmost thing that's open, or failing that clears
	/// what's found, then what's checked.
	pub fn escape(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if self.popup.take().is_some() || self.app_menu_open.take().is_some() {
		} else if self.cleanup_confirming {
			self.cleanup_confirming = false;
		} else if self.ask.take().is_some() || self.issues.take().is_some() {
		} else if self.suggesting {
			window.focus(&self.focus);
		} else if self.finding_something(cx) {
			self.clear_find(cx);
		} else if self.cleanup_open {
			self.cleanup_open = false;
		} else {
			self.selection.clear();
		}
		cx.notify();
	}
}

pub fn is_dark(appearance: WindowAppearance) -> bool {
	matches!(
		appearance,
		WindowAppearance::Dark | WindowAppearance::VibrantDark
	)
}
