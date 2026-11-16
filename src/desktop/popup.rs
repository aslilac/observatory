// The menu that pops up at the pointer (a row's or a wedge's right-click
// menu) or under a button (the sort picker, the title bar's menus). There's
// one at a time, and it's the workspace's.

use crate::chrome::TITLE_BAR_HEIGHT;
use crate::controls::icon;
use crate::menus::REVEAL;
use crate::workspace::Workspace;
use gpui::{
	AnyElement, ClipboardItem, Context, Corner, Div, Edges, MouseButton, Pixels, Point,
	SharedString, Stateful, Window, anchored, deferred, div, prelude::*, px, relative,
};
use observatory_core::scans::FAKE;
use observatory_core::tree::Item;
use std::path::Path;
use std::rc::Rc;

type Run = Rc<dyn Fn(&mut Workspace, &mut Window, &mut Context<Workspace>)>;

// The menus that hang from a button of their own (`opens_menu`), as
// `app_menu_open` and `app_menu_hovered` know them: the menu bar's are counted
// from 0, and the primary menu is the last number there is.
pub const DEVELOPER_MENU: usize = usize::MAX - 1;
// The least of them: anything under it is one of the menu bar's.
pub const SORT_MENU: usize = usize::MAX - 2;

pub enum PopupItem {
	Action {
		label: SharedString,
		// Some for a menu whose items are checked or not.
		checked: Option<bool>,
		run: Run,
	},
	Separator,
	/// What the items after it are, up to the next rule.
	Heading(SharedString),
}

impl PopupItem {
	pub fn action(
		label: impl Into<SharedString>,
		run: impl Fn(&mut Workspace, &mut Window, &mut Context<Workspace>) + 'static,
	) -> Self {
		Self::Action {
			label: label.into(),
			checked: None,
			run: Rc::new(run),
		}
	}

	pub fn checked(self, is: bool) -> Self {
		match self {
			Self::Action { label, run, .. } => Self::Action {
				label,
				checked: Some(is),
				run,
			},
			other => other,
		}
	}
}

pub struct Popup {
	pub position: Point<Pixels>,
	// Which of its corners sits at `position`.
	pub corner: Corner,
	pub items: Vec<PopupItem>,
}

// Showing a place in the file manager, and copying where it is: what every
// menu about a file or folder has.
fn location_items(path: &str) -> Vec<PopupItem> {
	let (reveal, copy) = (path.to_string(), path.to_string());
	vec![
		PopupItem::action(REVEAL, move |_, _, cx| cx.reveal_path(Path::new(&reveal))),
		PopupItem::action("Copy path", move |_, _, cx| {
			cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()))
		}),
	]
}

/// Right-click items for a file or folder in a list, or its wedge.
pub fn item_menu(item: &Item) -> Vec<PopupItem> {
	let mut items = Vec::new();
	let real = !item.path.starts_with(FAKE);
	// "Open" on a folder would land in the file manager showing what's in
	// it, which is what revealing it does: it's only there for files.
	if real && !item.directory {
		let path = item.path.clone();
		items.push(PopupItem::action("Open", move |_, _, cx| {
			cx.open_with_system(Path::new(&path))
		}));
	}
	if real {
		items.extend(location_items(&item.path));
		items.push(PopupItem::Separator);
	}
	let item = item.clone();
	items.push(PopupItem::action("Move to cleanup", move |this, _, cx| {
		this.move_to_cleanup(vec![item.clone()], cx)
	}));
	items
}

/// Right-click items for something in the cleanup panel.
pub fn queued_menu(path: &str) -> Vec<PopupItem> {
	let mut items = Vec::new();
	if !path.starts_with(FAKE) {
		items.extend(location_items(path));
		items.push(PopupItem::Separator);
	}
	let path = path.to_string();
	items.push(PopupItem::action(
		"Remove from cleanup",
		move |this, _, cx| {
			this.unqueue(&path, cx);
		},
	));
	items
}

/// Right-click items for a disk or a recent folder on the welcome screen.
/// `rescan` is for a place with a scan to replace; `recent` for one the menu
/// can take off the list.
pub fn place_menu(path: &str, rescan: bool, recent: bool) -> Vec<PopupItem> {
	let mut items = Vec::new();
	if rescan {
		let path = path.to_string();
		items.push(PopupItem::action("Rescan", move |this, window, cx| {
			this.rescan(&path, window, cx);
			this.go_to(
				observatory_core::navigation::Place {
					inspecting: Some(path.clone()),
					cursor: Vec::new(),
				},
				window,
				cx,
			);
		}));
		items.push(PopupItem::Separator);
	}
	items.extend(location_items(path));
	if recent {
		let path = path.to_string();
		items.push(PopupItem::Separator);
		items.push(PopupItem::action(
			"Remove from recents",
			move |this, _, cx| {
				this.store.remove_recent(&path);
				this.publish_menus(cx);
				cx.notify();
			},
		));
	}
	items
}

impl Workspace {
	pub fn show_popup(
		&mut self,
		position: Point<Pixels>,
		items: Vec<PopupItem>,
		cx: &mut Context<Self>,
	) {
		self.popup = Some(Popup {
			position,
			corner: Corner::TopLeft,
			items,
		});
		cx.notify();
	}

	pub fn render_popup(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		let popup = self.popup.as_ref()?;
		Some(
			deferred(
				anchored()
					.position(popup.position)
					.anchor(popup.corner)
					.snap_to_window_with_margin(Edges::all(px(8.) + self.frame.margin()))
					.child(self.render_menu(&popup.items, cx)),
			)
			.with_priority(3)
			.into_any_element(),
		)
	}

	/// What's behind an open menu, and in front of everything else: nothing
	/// seen, but it keeps the pointer from what's under it, so nothing there
	/// lights up as if a press would reach it (it wouldn't: a press outside
	/// a menu only shuts it). Under one of the menu bar's menus it leaves the
	/// title bar out, since the pointer going over another menu's name is
	/// what switches to it.
	pub fn render_menu_backdrop(&self) -> Option<AnyElement> {
		let in_menu_bar = self.app_menu_open.is_some_and(|menu| menu < SORT_MENU);
		if self.popup.is_none() && self.app_menu_open.is_none() {
			return None;
		}
		let top = if in_menu_bar { TITLE_BAR_HEIGHT } else { 0. };
		Some(
			deferred(
				div()
					.absolute()
					.top(px(top))
					.bottom_0()
					.left_0()
					.right_0()
					.occlude(),
			)
			.with_priority(2)
			.into_any_element(),
		)
	}

	/// Makes `button` what opens a menu, which hangs from it: under it, with
	/// their left edges in line (`Corner::TopLeft`) or their right ones. A
	/// press on the button opens the menu, and another shuts it. `menu` is
	/// which one it is, among the menu bar's.
	pub fn opens_menu(
		&self,
		button: Stateful<Div>,
		menu: usize,
		corner: Corner,
		items: impl FnOnce(&Self) -> Vec<PopupItem>,
		cx: &mut Context<Self>,
	) -> Stateful<Div> {
		let p = self.palette;
		let open = self.app_menu_open == Some(menu);
		button
			.relative()
			.when(open, |this| {
				// It's drawn from inside the button, so it's wherever that is.
				let under = div().absolute().top(relative(1.)).mt(px(4.));
				let under = if corner == Corner::TopRight {
					under.right_0()
				} else {
					under.left_0()
				};
				this.bg(p.fill).child(
					under.child(
						deferred(
							anchored()
								.anchor(corner)
								.snap_to_window_with_margin(Edges::all(
									px(8.) + self.frame.margin(),
								))
								.child(self.render_menu(&items(self), cx)),
						)
						.with_priority(3),
					),
				)
			})
			// The pointer being on the button is what tells a press on it
			// from a press outside the open menu.
			.on_hover(cx.listener(move |this, over: &bool, _, cx| {
				if *over {
					this.app_menu_hovered = Some(menu);
				} else if this.app_menu_hovered == Some(menu) {
					this.app_menu_hovered = None;
				}
				cx.notify();
			}))
			.on_mouse_down(
				MouseButton::Left,
				cx.listener(move |this, _, _, cx| {
					this.popup = None;
					this.app_menu_open = (this.app_menu_open != Some(menu)).then_some(menu);
					cx.notify();
				}),
			)
	}

	/// A menu of `items`, for whoever puts it somewhere: at a point (the one
	/// above), or under the thing that opened it (the title bar's menus). It
	/// shuts on a press anywhere else, which does nothing more than that.
	pub fn render_menu(&self, items: &[PopupItem], cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let rows = items.iter().enumerate().map(|(index, item)| match item {
			PopupItem::Heading(label) => div()
				.px(px(10.))
				.pt(px(4.))
				.pb(px(2.))
				.text_size(px(11.))
				.font_weight(gpui::FontWeight::MEDIUM)
				.text_color(p.faint)
				.child(label.clone())
				.into_any_element(),
			PopupItem::Separator => div()
				.my(px(4.))
				.mx(px(6.))
				.h(px(1.))
				.bg(p.line_soft)
				.into_any_element(),
			PopupItem::Action {
				label,
				checked,
				run,
			} => {
				let run = run.clone();
				div()
					.id(("popup-item", index))
					.flex()
					.items_center()
					.gap(px(8.))
					.h(px(26.))
					.px(px(10.))
					.rounded(px(5.))
					.cursor_pointer()
					.hover(move |style| style.bg(p.fill))
					.when_some(*checked, |this, checked| {
						this.child(
							div()
								.w(px(12.))
								.when(checked, |this| this.child(icon("check", 12., p.default))),
						)
					})
					.child(label.clone())
					.on_click(cx.listener(move |this, _, window, cx| {
						this.popup = None;
						this.app_menu_open = None;
						run(this, window, cx);
						cx.notify();
					}))
					.into_any_element()
			}
		});
		let menu = div()
			.id("popup")
			.occlude()
			.min_w(px(180.))
			.p(px(4.))
			.rounded(px(8.))
			.bg(p.background)
			.border_1()
			.border_color(p.line)
			.shadow_lg()
			.text_size(px(12.))
			.text_color(p.default)
			.on_mouse_down_out(cx.listener(|this, _, _, cx| {
				// A press on what the open menu hangs from (its name in the
				// menu bar, its button) is that's to answer: it shuts the
				// menu.
				if this.app_menu_open.is_some() && this.app_menu_hovered == this.app_menu_open {
					return;
				}
				this.popup = None;
				this.app_menu_open = None;
				cx.notify();
				// And that's all the press does: it isn't also a press on
				// whatever it landed on.
				cx.stop_propagation();
			}))
			.children(rows);
		menu.into_any_element()
	}
}
