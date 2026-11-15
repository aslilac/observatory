// The window around the screens: the title bar, the toolbar each screen
// puts under it, and the layers (the cleanup drawer, modals, menus) that go
// over whichever screen is showing.

use crate::controls::{icon, icon_button, tip};
use crate::menus;
use crate::popup::{Popup, PopupItem};
use crate::window_frame::{
	caption_buttons, has_native_title_bar, moves_window, resize_cursor, resize_edge,
};
use crate::workspace::{Screen, Workspace};
use gpui::{
	AnyElement, Context, Corner, ExternalPaths, FontWeight, HitboxBehavior, MenuItem, MouseButton,
	MouseMoveEvent, NavigationDirection, Window, canvas, div, point, prelude::*, px,
};

pub const TITLE_BAR_HEIGHT: f32 = 36.;
pub const TOOLBAR_HEIGHT: f32 = 44.;

impl Render for Workspace {
	fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let p = self.palette;
		let screen = match self.screen() {
			Screen::Welcome => self.render_welcome(cx),
			Screen::Scanning(scan) => self.render_scanning(&scan, cx),
			Screen::Failed(scan) => self.render_failed(&scan, cx),
			Screen::Inspect(scan) => self.render_inspect(&scan, window, cx),
		};
		div()
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
			.child(self.render_title_bar(window, cx))
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
			.children(self.render_popup(cx))
			// Where the app decorates its own window (Linux), its edges are
			// what it's resized by: a press on one is that and nothing else,
			// and the pointer says so while it's over one.
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
// rest, between rules.
fn popup_items(items: &[MenuItem]) -> Vec<PopupItem> {
	let mut popup = Vec::new();
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
				popup.extend(popup_items(&menu.items));
				popup.push(PopupItem::Separator);
			}
			_ => {}
		}
	}
	popup
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
			.children(self.render_update_button(cx))
			// What's only for working on the app, in builds that aren't for
			// release.
			.when(cfg!(debug_assertions), |this| {
				this.child(
					icon_button("developer", "wrench", true, &p)
						.occlude()
						.tooltip(tip("Developer"))
						.on_click(cx.listener(|this, event: &gpui::ClickEvent, _, cx| {
							cx.stop_propagation();
							this.popup = Some(Popup {
								position: point(event.position().x, px(TITLE_BAR_HEIGHT - 4.)),
								corner: Corner::TopRight,
								items: vec![PopupItem::action(
									"Load fake disk",
									|this, window, cx| this.load_demo_disk(window, cx),
								)],
							});
							cx.notify();
						})),
				)
			})
			.child(
				icon_button("theme", if p.dark { "sun" } else { "moon" }, true, &p)
					.occlude()
					.on_click(cx.listener(|this, _, _, cx| {
						cx.stop_propagation();
						this.toggle_dark(cx);
					})),
			)
			.when_some(buttons, |this, buttons| {
				this.child(div().flex_none().w(px(8.))).child(buttons)
			})
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

	fn render_app_menus(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
		let p = self.palette;
		menus::app_menus(self.store.recent_scans(), p.dark)
			.into_iter()
			.enumerate()
			.map(|(index, menu)| {
				let open = self.app_menu_open == Some(index);
				div()
					.id(("app-menu", index))
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
					.on_click(cx.listener(move |this, event: &gpui::ClickEvent, _, cx| {
						let items = popup_items(&menu.items);
						this.app_menu_open = Some(index);
						this.popup = Some(Popup {
							position: point(event.position().x - px(8.), px(TITLE_BAR_HEIGHT - 4.)),
							corner: Corner::TopLeft,
							items,
						});
						cx.notify();
					}))
					.into_any_element()
			})
			.collect()
	}

	/// The bar under the title bar: back and forward, where the user is,
	/// and whatever the screen puts at its right (`right`, then `chips`).
	pub fn render_toolbar(
		&self,
		right: Option<AnyElement>,
		chips: Vec<AnyElement>,
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
				.truncate()
				.child(label)
				.map(|this| {
					if last {
						this.font_weight(FontWeight::SEMIBOLD).text_color(p.default)
					} else {
						this.text_color(p.muted)
							.cursor_pointer()
							.hover(move |style| style.text_color(p.default))
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
					crumbs.push(div().text_color(p.faint).child("…").into_any_element());
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
		div()
			.flex()
			.flex_none()
			.items_center()
			.gap(px(6.))
			.h(px(TOOLBAR_HEIGHT))
			.px(px(10.))
			.border_b_1()
			.border_color(p.line_soft)
			.child(
				icon_button("back", "arrow-left", self.nav.can_back(), &p)
					.on_click(cx.listener(|this, _, window, cx| this.go_back(window, cx))),
			)
			.child(
				icon_button("forward", "arrow-right", self.nav.can_forward(), &p)
					.on_click(cx.listener(|this, _, window, cx| this.go_forward(window, cx))),
			)
			.child(
				div()
					.flex_1()
					.min_w_0()
					.overflow_hidden()
					.flex()
					.items_center()
					.gap(px(6.))
					.ml(px(4.))
					.children(crumbs),
			)
			.children(right)
			.children(chips)
			.into_any_element()
	}
}
