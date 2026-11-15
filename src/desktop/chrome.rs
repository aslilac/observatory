// The window around the screens: the title bar, the toolbar each screen
// puts under it (on Linux, the one bar), and the layers (the cleanup drawer, modals, menus) that go
// over whichever screen is showing.

use crate::controls::{icon, icon_button, tip};
use crate::menus;
use crate::popup::{Popup, PopupItem};
use crate::window_frame::{
	Frame, HEADER_BAR, caption_buttons, has_native_title_bar, header_buttons, moves_window,
	resize_cursor, resize_edge,
};
use crate::workspace::{Screen, Workspace};
use gpui::{
	AnyElement, Context, Corner, Edges, ExternalPaths, FontWeight, HitboxBehavior, MenuItem,
	MouseButton, MouseMoveEvent, NavigationDirection, Window, anchored, canvas, deferred, div,
	point, prelude::*, px,
};

pub const TITLE_BAR_HEIGHT: f32 = 36.;
pub const TOOLBAR_HEIGHT: f32 = 44.;

// What stands for the primary menu's button among the menu bar's menus, in
// `app_menu_open` and `app_menu_hovered`.
const PRIMARY_MENU: usize = usize::MAX;

impl Render for Workspace {
	fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let p = self.palette;
		self.frame = Frame::of(window);
		let frame = self.frame;
		let screen = match self.screen() {
			Screen::Welcome => self.render_welcome(window, cx),
			Screen::Scanning(scan) => self.render_scanning(&scan, window, cx),
			Screen::Failed(scan) => self.render_failed(&scan, window, cx),
			Screen::Inspect(scan) => self.render_inspect(&scan, window, cx),
		};
		let workspace = div()
			.id("workspace")
			.track_focus(&self.focus)
			.relative()
			.size_full()
			.flex()
			.flex_col()
			.bg(p.background)
			.text_color(p.default)
			.font(crate::fonts::inter())
			.text_size(px(13.))
			.line_height(px(18.))
			.on_drop(cx.listener(|this, paths: &ExternalPaths, window, cx| {
				this.dropped(paths, window, cx)
			}))
			// The mouse's own back and forward buttons.
			.on_mouse_down(
				MouseButton::Navigate(NavigationDirection::Back),
				cx.listener(|this, _, window, cx| this.go_back(window, cx)),
			)
			.on_mouse_down(
				MouseButton::Navigate(NavigationDirection::Forward),
				cx.listener(|this, _, window, cx| this.go_forward(window, cx)),
			)
			.when(!HEADER_BAR, |this| {
				this.child(self.render_title_bar(window, cx))
			})
			.child(
				div()
					.relative()
					.flex_1()
					.min_h_0()
					.flex()
					.flex_col()
					.child(screen)
					.children(self.render_cleanup_panel(cx)),
			)
			.children(self.render_issues(cx))
			.children(self.render_cleanup_modal(cx))
			.children(self.render_ask(cx))
			.children(self.render_popup(cx));
		// Where the app decorates its own window (Linux), the window's drawn
		// inside its shadow, and the shadow is what it's resized by: a press
		// there is that and nothing else, and the pointer says so while it's
		// over it.
		frame
			.pad(div().id("window").size_full())
			.child(frame.window(workspace))
			.on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, window, cx| {
				let edge = resize_edge(window, event.position);
				if edge != this.resize_edge {
					this.resize_edge = edge;
					cx.notify();
				}
			}))
			.capture_any_mouse_down(|event, window, cx| {
				if event.button == MouseButton::Left
					&& let Some(edge) = resize_edge(window, event.position)
				{
					window.start_window_resize(edge);
					cx.stop_propagation();
				}
			})
			.children(self.resize_edge.map(|edge| {
				canvas(
					|bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
					move |_, hitbox, window, _| {
						window.set_cursor_style(resize_cursor(edge), &hitbox)
					},
				)
				.absolute()
				.size_full()
			}))
	}
}

// A menu's items, as the popup has them. A submenu's are set in among the
// rest, between rules, under its name.
fn popup_items(items: &[MenuItem]) -> Vec<PopupItem> {
	let mut popup = Vec::new();
	add_popup_items(items, &mut popup);
	// No rule at either end, or two together.
	let mut tidy: Vec<PopupItem> = Vec::new();
	for item in popup {
		let rule = matches!(item, PopupItem::Separator);
		if rule && matches!(tidy.last(), None | Some(PopupItem::Separator)) {
			continue;
		}
		tidy.push(item);
	}
	if matches!(tidy.last(), Some(PopupItem::Separator)) {
		tidy.pop();
	}
	tidy
}

fn add_popup_items(items: &[MenuItem], popup: &mut Vec<PopupItem>) {
	for item in items {
		match item {
			MenuItem::Separator => popup.push(PopupItem::Separator),
			MenuItem::Action { name, action, .. } => {
				let action = action.boxed_clone();
				popup.push(PopupItem::action(name.clone(), move |_, window, cx| {
					window.dispatch_action(action.boxed_clone(), cx)
				}));
			}
			MenuItem::Submenu(menu) => {
				popup.push(PopupItem::Separator);
				popup.push(PopupItem::Heading(menu.name.clone()));
				add_popup_items(&menu.items, popup);
				popup.push(PopupItem::Separator);
			}
			_ => {}
		}
	}
}

impl Workspace {
	fn render_title_bar(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let mac = cfg!(target_os = "macos");
		let title = self.title_bar_text();
		// The window's own buttons, off macOS, where they're the app's to
		// draw. They go right to the bar's end.
		let buttons = caption_buttons(window, p.muted, p.fill);
		let bar = div()
			.id("title-bar")
			.flex()
			.flex_none()
			.items_center()
			.h(px(TITLE_BAR_HEIGHT))
			.when(buttons.is_none(), |this| this.pr(px(8.)))
			.border_b_1()
			.border_color(p.line_soft);
		// The bar is what the window's moved by. What's in it to press takes
		// its own presses (`occlude`).
		moves_window(bar, window)
			.map(|this| {
				if mac {
					// The traffic lights sit in the bar, unless the window's
					// full screen.
					this.when(!window.is_fullscreen(), |this| this.pl(px(76.)))
				} else {
					// No native menu bar: the bar draws the menus itself.
					this.pl(px(6.)).children(self.render_app_menus(cx))
				}
			})
			.child(
				div()
					.flex_1()
					.min_w_0()
					.flex()
					.justify_center()
					.text_size(px(12.))
					.font_weight(FontWeight::MEDIUM)
					.text_color(p.muted)
					// A desktop that draws a title bar of its own has the
					// title in it already.
					.when(!has_native_title_bar(window), |this| {
						this.child(div().truncate().child(title))
					}),
			)
			.children(self.render_bar_tools(TITLE_BAR_HEIGHT, cx))
			.when_some(buttons, |this, buttons| {
				this.child(div().flex_none().w(px(8.))).child(buttons)
			})
			.into_any_element()
	}

	// What's at the end of the window's bar, whichever bar that is: the
	// update, the developer's menu, and the theme (except on Linux, where
	// it's in the primary menu). `bar` is how tall the bar
	// is, for where a menu opens under it.
	fn render_bar_tools(&self, bar: f32, cx: &mut Context<Self>) -> Vec<AnyElement> {
		let p = self.palette;
		let mut tools = Vec::new();
		tools.extend(self.render_update_button(cx));
		// What's only for working on the app, in builds that aren't for
		// release.
		if cfg!(debug_assertions) {
			tools.push(
				icon_button("developer", "wrench", true, &p)
					.occlude()
					.tooltip(tip("Developer"))
					.on_click(cx.listener(move |this, event: &gpui::ClickEvent, _, cx| {
						cx.stop_propagation();
						this.popup = Some(Popup {
							position: point(event.position().x, this.frame.top() + px(bar - 4.)),
							corner: Corner::TopRight,
							items: vec![PopupItem::action("Load fake disk", |this, window, cx| {
								this.load_demo_disk(window, cx)
							})],
						});
						cx.notify();
					}))
					.into_any_element(),
			);
		}
		// Where there's a primary menu, the theme's in that instead.
		if HEADER_BAR {
			return tools;
		}
		tools.push(
			icon_button("theme", if p.dark { "sun" } else { "moon" }, true, &p)
				.occlude()
				.tooltip(tip(if p.dark {
					"Switch to Light Mode"
				} else {
					"Switch to Dark Mode"
				}))
				.on_click(cx.listener(|this, _, _, cx| {
					cx.stop_propagation();
					this.toggle_dark(cx);
				}))
				.into_any_element(),
		);
		tools
	}

	/// Opens the primary menu under its button, or shuts it if it's open.
	pub fn toggle_primary_menu(&mut self, cx: &mut Context<Self>) {
		self.popup = None;
		self.app_menu_open = (self.app_menu_open != Some(PRIMARY_MENU)).then_some(PRIMARY_MENU);
		cx.notify();
	}

	// The button the menus are behind, at the end of the toolbar, where
	// there's no menu bar (Linux). Its menu is drawn from inside it, as the
	// menu bar's are, with its right edge under the button's.
	fn render_primary_menu_button(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let open = self.app_menu_open == Some(PRIMARY_MENU);
		icon_button("primary-menu", "menu", true, &p)
			.relative()
			.occlude()
			.tooltip(tip("Main Menu"))
			.when(open, |this| {
				let items = popup_items(&menus::primary_menu(
					self.store.recent_scans(),
					self.palette.dark,
				));
				this.bg(p.fill).child(
					div().absolute().right_0().top(px(30.)).child(
						deferred(
							anchored()
								.anchor(Corner::TopRight)
								.snap_to_window_with_margin(Edges::all(
									px(8.) + self.frame.margin(),
								))
								.child(self.render_menu(&items, cx)),
						)
						.with_priority(3),
					),
				)
			})
			// The pointer being on the button is what tells a press on it
			// from a press outside the open menu.
			.on_hover(cx.listener(|this, over: &bool, _, cx| {
				if *over {
					this.app_menu_hovered = Some(PRIMARY_MENU);
				} else if this.app_menu_hovered == Some(PRIMARY_MENU) {
					this.app_menu_hovered = None;
				}
				cx.notify();
			}))
			.on_mouse_down(
				MouseButton::Left,
				cx.listener(|this, _, _, cx| this.toggle_primary_menu(cx)),
			)
			.into_any_element()
	}

	fn title_bar_text(&self) -> String {
		let place = self.nav.current();
		match (&place.inspecting, &self.tree) {
			(Some(_), Some(tree)) => match place.cursor.last() {
				Some(folder) => format!("{folder} — {}", tree.name),
				None => tree.name.clone(),
			},
			_ => "Observatory".to_string(),
		}
	}

	// The menu bar, where the app draws it. It works as one does: a press
	// on a name opens its menu (or shuts it, if it's the one open), and with
	// one open, the pointer going over another's name switches to that. The
	// open menu is drawn from inside its name, so it sits under it wherever
	// that is.
	fn render_app_menus(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
		let p = self.palette;
		menus::app_menus(self.store.recent_scans(), p.dark)
			.into_iter()
			.enumerate()
			.map(|(index, menu)| {
				let open = self.app_menu_open == Some(index);
				div()
					.id(("app-menu", index))
					.relative()
					.occlude()
					.px(px(8.))
					.h(px(24.))
					.flex()
					.items_center()
					.rounded(px(5.))
					.text_size(px(12.))
					.cursor_pointer()
					.when(open, |this| this.bg(p.fill))
					.hover(move |style| style.bg(p.fill))
					.child(menu.name.clone())
					.when(open, |this| {
						this.child(
							div().absolute().left_0().top(px(28.)).child(
								deferred(
									anchored()
										.snap_to_window_with_margin(Edges::all(px(8.)))
										.child(self.render_menu(&popup_items(&menu.items), cx)),
								)
								.with_priority(3),
							),
						)
					})
					.on_mouse_down(
						MouseButton::Left,
						cx.listener(move |this, _, _, cx| {
							this.popup = None;
							this.app_menu_open =
								(this.app_menu_open != Some(index)).then_some(index);
							cx.notify();
						}),
					)
					.on_hover(cx.listener(move |this, over: &bool, _, cx| {
						// Which name the pointer's on is what tells a press
						// on one from a press outside the open menu.
						if *over {
							this.app_menu_hovered = Some(index);
							if this.app_menu_open.is_some_and(|open| open != index) {
								this.app_menu_open = Some(index);
							}
						} else if this.app_menu_hovered == Some(index) {
							this.app_menu_hovered = None;
						}
						cx.notify();
					}))
					.into_any_element()
			})
			.collect()
	}

	/// The bar under the title bar: back and forward, where the user is,
	/// and whatever the screen puts at its right (`right`, then `chips`).
	///
	/// On Linux it's the window's one bar: the window's moved by it, and the
	/// tools, the menus, and the window's buttons are in it too.
	pub fn render_toolbar(
		&self,
		right: Option<AnyElement>,
		chips: Vec<AnyElement>,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> AnyElement {
		let p = self.palette;
		let place = self.nav.current();
		let mut crumbs: Vec<AnyElement> = Vec::new();
		let crumb = |index: usize, label: String, last: bool| {
			div()
				.id(("crumb", index))
				.flex_none()
				.max_w(px(220.))
				// Room for the background one gets under the pointer. It's
				// what spaces them from the chevrons too, in place of a gap.
				.px(px(6.))
				.py(px(2.))
				.rounded(px(5.))
				.truncate()
				.child(label)
				.map(|this| {
					if last {
						this.font_weight(FontWeight::SEMIBOLD).text_color(p.default)
					} else {
						// Not part of the bar, which may move the window.
						this.occlude()
							.text_color(p.muted)
							.cursor_pointer()
							.hover(move |style| style.bg(p.fill).text_color(p.default))
					}
				})
		};
		let rule = || icon("chevron-right", 12., p.faint).into_any_element();
		match &place.inspecting {
			None => crumbs.push(crumb(0, "Disks and folders".into(), true).into_any_element()),
			Some(path) => {
				crumbs.push(
					crumb(0, "Disks and folders".into(), false)
						.on_click(cx.listener(|this, _, window, cx| this.go_home(window, cx)))
						.into_any_element(),
				);
				crumbs.push(rule());
				let root = self.root_name(path);
				let depth = place.cursor.len();
				crumbs.push(
					crumb(1, root, depth == 0)
						.on_click(cx.listener(|this, _, window, cx| {
							this.set_cursor(Vec::new(), window, cx)
						}))
						.into_any_element(),
				);
				// Deep in, only the last few folders are named.
				let first = depth.saturating_sub(3);
				if first > 0 {
					crumbs.push(rule());
					crumbs.push(
						div()
							.px(px(6.))
							.text_color(p.faint)
							.child("…")
							.into_any_element(),
					);
				}
				for (at, name) in place.cursor.iter().enumerate().skip(first) {
					let to = place.cursor[..=at].to_vec();
					crumbs.push(rule());
					crumbs.push(
						crumb(at + 2, name.clone(), at + 1 == depth)
							.on_click(cx.listener(move |this, _, window, cx| {
								this.set_cursor(to.clone(), window, cx)
							}))
							.into_any_element(),
					);
				}
			}
		}
		// What's pressed in the bar is that and not a press on the bar, which
		// may move the window.
		let own = |element: AnyElement| {
			div()
				.flex_none()
				.occlude()
				.child(element)
				.into_any_element()
		};
		let bar = div()
			.id("toolbar")
			.flex()
			.flex_none()
			.items_center()
			.gap(px(6.))
			.h(px(TOOLBAR_HEIGHT))
			.px(px(10.))
			.border_b_1()
			.border_color(p.line_soft);
		let bar = if HEADER_BAR {
			moves_window(bar, window)
		} else {
			bar
		};
		let color = p.default;
		bar.when_some(header_buttons(window, true, color, cx), |this, buttons| {
			this.child(buttons).child(div().flex_none().w(px(6.)))
		})
		.child(
			icon_button("back", "arrow-left", self.nav.can_back(), &p)
				.occlude()
				.on_click(cx.listener(|this, _, window, cx| this.go_back(window, cx))),
		)
		.child(
			icon_button("forward", "arrow-right", self.nav.can_forward(), &p)
				.occlude()
				.on_click(cx.listener(|this, _, window, cx| this.go_forward(window, cx))),
		)
		.child(
			div()
				.flex_1()
				.min_w_0()
				.overflow_hidden()
				.flex()
				.items_center()
				.children(crumbs),
		)
		.children(right.map(own))
		.children(chips.into_iter().map(own))
		.when(HEADER_BAR, |this| {
			this.child(div().flex_none().w(px(2.)))
				.children(self.render_bar_tools(TOOLBAR_HEIGHT, cx))
				.child(self.render_primary_menu_button(cx))
		})
		.when_some(header_buttons(window, false, color, cx), |this, buttons| {
			this.child(div().flex_none().w(px(6.))).child(buttons)
		})
		.into_any_element()
	}
}
