// The window's own furniture, where the app draws it: there's one bar at the
// top, the app's, and off macOS the buttons that close, maximize and minimize
// the window sit in it, and it's what the window is moved by.
//
// macOS puts its traffic lights in the app's title bar. Windows hides its
// title bar and is told which parts of ours stand for it
// (`WindowControlArea`), so snapping, the buttons, and dragging are still its
// own doing. On Linux there's no title bar of the app's: the toolbar is the
// one bar, as a GNOME app's header bar is, with the menus behind a button at
// its end. The app asks to decorate its own windows, and where it gets to
// (GNOME never decorates a window itself) does all of it: moving, resizing by
// the edges, and the buttons, round as GNOME's are, on the sides the desktop
// says. A desktop that decorates the window anyway (KDE) is left to, and the
// toolbar sits under its title bar with no buttons and moves nothing.

use crate::controls::icon;
use gpui::{
	AnyElement, App, BoxShadow, Corner, CursorStyle, Decorations, Div, Global, Hsla, MouseButton,
	MouseDownEvent, Pixels, Point, ResizeEdge, Size, Stateful, Tiling, Window, WindowControlArea,
	div, hsla, point, prelude::*, px, rgb, size, white,
};

/// Whether the toolbar is the window's one bar, with no title bar of the
/// app's over it: Linux, and the BSDs with it.
pub const HEADER_BAR: bool = cfg!(not(any(target_os = "macos", windows)));

// How far along from a corner a press that resizes the window is still on
// the corner.
const CORNER: f32 = 16.;

// Where the app draws the window's frame, how far its shadow goes past the
// window, which is also how near the window a press resizes it, as GNOME's
// do; and how round the window's corners are, as libadwaita's are.
const INSET: f32 = 12.;
const RADIUS: f32 = 12.;

/// The window's frame, where the app draws it (a Linux window that decorates
/// itself): its corners are round and it has a shadow, along the edges it
/// isn't tiled against. Maximized or full screen, it's tiled against all of
/// them, and looks like any other window.
#[derive(Clone, Copy, Default)]
pub struct Frame {
	tiling: Option<Tiling>,
}

impl Frame {
	/// `window`'s, which the window is told about (where its shadow ends and
	/// it begins). Once per frame, before anything's laid out by it.
	pub fn of(window: &mut Window) -> Self {
		let frame = Self::read(window);
		if frame.tiling.is_some() {
			window.set_client_inset(px(INSET));
		}
		frame
	}

	/// `window`'s, without telling it.
	pub fn read(window: &Window) -> Self {
		if !HEADER_BAR {
			return Self::default();
		}
		let Decorations::Client { tiling } = window.window_decorations() else {
			return Self::default();
		};
		Self {
			tiling: Some(tiling),
		}
	}

	/// Where the window starts, under its shadow, from the corner of what's
	/// drawn.
	pub fn origin(&self) -> Point<Pixels> {
		match self.tiling {
			Some(tiling) => point(
				if tiling.left { px(0.) } else { px(INSET) },
				if tiling.top { px(0.) } else { px(INSET) },
			),
			None => Point::default(),
		}
	}

	/// How big the window is, of `drawn`, what's drawn with its shadow.
	pub fn inner(&self, drawn: Size<Pixels>) -> Size<Pixels> {
		let Some(tiling) = self.tiling else {
			return drawn;
		};
		let side = |tiled: bool| if tiled { px(0.) } else { px(INSET) };
		size(
			drawn.width - side(tiling.left) - side(tiling.right),
			drawn.height - side(tiling.top) - side(tiling.bottom),
		)
	}

	/// Pads what's around the window out to where its shadow ends.
	pub fn pad<E: Styled + FluentBuilder>(&self, element: E) -> E {
		let Some(tiling) = self.tiling else {
			return element;
		};
		element
			.when(!tiling.top, |this| this.pt(px(INSET)))
			.when(!tiling.bottom, |this| this.pb(px(INSET)))
			.when(!tiling.left, |this| this.pl(px(INSET)))
			.when(!tiling.right, |this| this.pr(px(INSET)))
	}

	// Whether the window's corner is a round one.
	fn round_at(&self, corner: Corner) -> bool {
		let Some(tiling) = self.tiling else {
			return false;
		};
		match corner {
			Corner::TopLeft => !tiling.top && !tiling.left,
			Corner::TopRight => !tiling.top && !tiling.right,
			Corner::BottomLeft => !tiling.bottom && !tiling.left,
			Corner::BottomRight => !tiling.bottom && !tiling.right,
		}
	}

	/// Rounds `element`'s `corners` as the window's are, for the window
	/// itself and whatever's drawn up to its corners over everything else
	/// (a modal's scrim, the cleanup drawer).
	pub fn round<E: Styled>(&self, element: E, corners: &[Corner]) -> E {
		let radius = px(RADIUS);
		corners.iter().fold(element, |element, &corner| {
			if !self.round_at(corner) {
				return element;
			}
			match corner {
				Corner::TopLeft => element.rounded_tl(radius),
				Corner::TopRight => element.rounded_tr(radius),
				Corner::BottomLeft => element.rounded_bl(radius),
				Corner::BottomRight => element.rounded_br(radius),
			}
		})
	}

	/// The window itself: round, with its shadow and a hairline around it,
	/// as a GNOME window has, where it isn't tiled.
	pub fn window<E: Styled>(&self, element: E) -> E {
		let Some(tiling) = self.tiling else {
			return element;
		};
		let element = self.round(element, &ALL_CORNERS);
		if tiling.is_tiled() {
			return element;
		}
		element.shadow(vec![
			BoxShadow {
				color: hsla(0., 0., 0., 0.3),
				offset: point(px(0.), px(2.)),
				blur_radius: px(8.),
				spread_radius: px(0.),
			},
			// The hairline.
			BoxShadow {
				color: hsla(0., 0., 0., 0.18),
				offset: point(px(0.), px(0.)),
				blur_radius: px(0.),
				spread_radius: px(1.),
			},
		])
	}

	/// How far into the window a popup has to stay: past the shadow.
	pub fn margin(&self) -> Pixels {
		if self.tiling.is_some() {
			px(INSET)
		} else {
			px(0.)
		}
	}
}

/// How much bigger to ask for a window to be than it's meant to look, for
/// its shadow, where the app draws one; gpui counts it in. (A desktop that
/// decorates the window itself leaves the window that much bigger.)
pub const SHADOW_ROOM: f32 = if HEADER_BAR { 2. * INSET } else { 0. };

pub const ALL_CORNERS: [Corner; 4] = [
	Corner::TopLeft,
	Corner::TopRight,
	Corner::BottomLeft,
	Corner::BottomRight,
];

/// Whether something else draws a title bar over the app's: a Linux desktop
/// that decorates the window whatever the app asks.
pub fn has_native_title_bar(window: &Window) -> bool {
	cfg!(not(any(target_os = "macos", windows)))
		&& matches!(window.window_decorations(), Decorations::Server)
}

// Whether the window's buttons are the app's to draw.
fn draws_buttons(window: &Window) -> bool {
	cfg!(not(target_os = "macos")) && !has_native_title_bar(window)
}

// One of the window's buttons. Windows presses it itself, going by `area`;
// anywhere else, whoever makes it says what a click does.
fn caption_button(
	name: &'static str,
	glyph: &'static str,
	area: WindowControlArea,
	color: Hsla,
	hover: Hsla,
) -> Stateful<Div> {
	let closes = area == WindowControlArea::Close;
	div()
		.id(name)
		.group(name)
		// Not part of the bar it's in, which moves the window.
		.occlude()
		.flex()
		.flex_none()
		.items_center()
		.justify_center()
		.w(px(46.))
		.h_full()
		.window_control_area(area)
		.hover(move |style| style.bg(if closes { rgb(0xe81123).into() } else { hover }))
		.child(
			icon(glyph, if closes { 15. } else { 12. }, color).when(closes, |icon| {
				icon.group_hover(name, |style| style.text_color(white()))
			}),
		)
}

/// The window's buttons, for the end of the app's title bar, where they're
/// the app's to draw.
pub fn caption_buttons(window: &Window, color: Hsla, hover: Hsla) -> Option<AnyElement> {
	if !draws_buttons(window) {
		return None;
	}
	// Windows acts on a press of one of these itself.
	let clicked = !cfg!(windows);
	let can = window.window_controls();
	let restore = window.is_maximized();
	Some(
		div()
			.flex()
			.flex_none()
			.h_full()
			.when(can.minimize, |this| {
				this.child(
					caption_button("minimize", "minus", WindowControlArea::Min, color, hover)
						.when(clicked, |button| {
							button.on_click(|_, window, _| window.minimize_window())
						}),
				)
			})
			.when(can.maximize, |this| {
				this.child(
					caption_button(
						"maximize",
						if restore { "copy" } else { "square" },
						WindowControlArea::Max,
						color,
						hover,
					)
					.when(clicked, |button| {
						button.on_click(|_, window, _| window.zoom_window())
					}),
				)
			})
			.child(close_button(color, hover))
			.into_any_element(),
	)
}

/// The button that closes the window, by itself, for a window with no others
/// (the About window).
pub fn close_button(color: Hsla, hover: Hsla) -> Stateful<Div> {
	if HEADER_BAR {
		return round_button("close", "x", color).on_click(|_, window, _| window.remove_window());
	}
	caption_button("close", "x", WindowControlArea::Close, color, hover)
		.when(!cfg!(windows), |button| {
			button.on_click(|_, window, _| window.remove_window())
		})
}

/// Whether `window` gets a close button of the app's.
pub fn draws_close_button(window: &Window) -> bool {
	draws_buttons(window)
}

/// One of the window's buttons, as a desktop's settings name it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Control {
	Minimize,
	Maximize,
	Close,
}

/// Which of the window's buttons go at each end of the bar, as the desktop
/// has them (GNOME's `button-layout`, "appmenu:minimize,maximize,close").
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ButtonLayout {
	pub left: Vec<Control>,
	pub right: Vec<Control>,
}

impl Global for ButtonLayout {}

impl Default for ButtonLayout {
	// Until the desktop says, or where it never does: all three, at the right.
	fn default() -> Self {
		Self {
			left: Vec::new(),
			right: vec![Control::Minimize, Control::Maximize, Control::Close],
		}
	}
}

impl ButtonLayout {
	/// GNOME's way of putting it: the left end's, a colon, the right end's,
	/// each a list with commas. What isn't a button ("appmenu", "icon",
	/// "spacer") is left out.
	pub fn parse(layout: &str) -> Self {
		let side = |names: &str| {
			names
				.split(',')
				.filter_map(|name| match name.trim() {
					"minimize" => Some(Control::Minimize),
					"maximize" => Some(Control::Maximize),
					"close" => Some(Control::Close),
					_ => None,
				})
				.collect()
		};
		let (left, right) = layout.split_once(':').unwrap_or(("", layout));
		Self {
			left: side(left),
			right: side(right),
		}
	}
}

/// Keeps the `ButtonLayout` global the desktop's, now and as it changes,
/// from the desktop portal (which a Flatpak can read too).
#[cfg(any(target_os = "linux", target_os = "freebsd"))]
pub fn follow_button_layout(cx: &mut App) {
	use ashpd::desktop::settings::Settings;
	use futures::StreamExt;
	const NAMESPACE: &str = "org.gnome.desktop.wm.preferences";
	const KEY: &str = "button-layout";

	cx.set_global(ButtonLayout::default());
	let (sender, mut layouts) = futures::channel::mpsc::unbounded::<String>();
	cx.background_executor()
		.spawn(async move {
			let settings = Settings::new().await?;
			if let Ok(layout) = settings.read::<String>(NAMESPACE, KEY).await {
				sender.unbounded_send(layout)?;
			}
			let mut changes = settings
				.receive_setting_changed_with_args::<String>(NAMESPACE, KEY)
				.await?;
			while let Some(layout) = changes.next().await {
				sender.unbounded_send(layout?)?;
			}
			anyhow::Ok(())
		})
		.detach();
	cx.spawn(async move |cx| {
		while let Some(layout) = layouts.next().await {
			let changed = cx.update(|cx| {
				cx.set_global(ButtonLayout::parse(&layout));
				cx.refresh_windows();
			});
			if changed.is_err() {
				break;
			}
		}
	})
	.detach();
}

#[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
pub fn follow_button_layout(_: &mut App) {}

// One of the window's buttons as GNOME draws them: a small round one, tinted
// with `color`, a little more under the pointer.
fn round_button(id: &'static str, glyph: &'static str, color: Hsla) -> Stateful<Div> {
	div()
		.id(id)
		// Not part of the bar it's in, which moves the window.
		.occlude()
		.flex()
		.flex_none()
		.items_center()
		.justify_center()
		.size(px(24.))
		.rounded_full()
		.bg(color.opacity(0.1))
		.hover(move |style| style.bg(color.opacity(0.16)))
		.active(move |style| style.bg(color.opacity(0.28)))
		.child(icon(glyph, 12., color))
}

/// The window's buttons for one end of the header bar, as the desktop lays
/// them out, where they're the app's to draw. `left` is which end.
pub fn header_buttons(window: &Window, left: bool, color: Hsla, cx: &App) -> Option<AnyElement> {
	if !HEADER_BAR || !draws_buttons(window) {
		return None;
	}
	let layout = cx.try_global::<ButtonLayout>().cloned().unwrap_or_default();
	let controls = if left { layout.left } else { layout.right };
	let can = window.window_controls();
	let restore = window.is_maximized();
	let buttons: Vec<AnyElement> = controls
		.into_iter()
		.filter_map(|control| {
			let button = match control {
				Control::Minimize if can.minimize => round_button("minimize", "minus", color)
					.on_click(|_, window, _| window.minimize_window()),
				Control::Maximize if can.maximize => {
					round_button("maximize", if restore { "copy" } else { "square" }, color)
						.on_click(|_, window, _| window.zoom_window())
				}
				Control::Close => round_button("close", "x", color)
					.on_click(|_, window, _| window.remove_window()),
				_ => return None,
			};
			Some(button.into_any_element())
		})
		.collect();
	if buttons.is_empty() {
		return None;
	}
	Some(
		div()
			.flex()
			.flex_none()
			.items_center()
			.gap(px(12.))
			.children(buttons)
			.into_any_element(),
	)
}

/// Makes `bar` what the window is moved by, and what a double click
/// maximizes it from. Whatever in it is something to press of its own (a
/// menu, a button) has to `occlude()`, or pressing it moves the window.
pub fn moves_window(bar: Stateful<Div>, window: &Window) -> Stateful<Div> {
	if cfg!(target_os = "macos") {
		// macOS moves the window by its title bar already.
		bar.on_click(|event, window, _| {
			if event.click_count() == 2 {
				window.titlebar_double_click();
			}
		})
	} else if cfg!(windows) {
		bar.window_control_area(WindowControlArea::Drag)
	} else if has_native_title_bar(window) {
		bar
	} else {
		bar.on_mouse_down(MouseButton::Left, |event: &MouseDownEvent, window, _| {
			if event.click_count == 2 {
				window.zoom_window();
			} else {
				window.start_window_move();
			}
		})
		.on_mouse_down(MouseButton::Right, |event: &MouseDownEvent, window, _| {
			window.show_window_menu(event.position)
		})
	}
}

/// Which edge or corner of the window a press at `position` would resize it
/// by, where resizing is the app's to do: a window on Linux that decorates
/// itself, and isn't maximized, full screen, or tiled along that edge. It's
/// a press on the window's shadow.
pub fn resize_edge(window: &Window, position: Point<Pixels>) -> Option<ResizeEdge> {
	if cfg!(any(target_os = "macos", windows)) || window.is_maximized() || window.is_fullscreen() {
		return None;
	}
	let Decorations::Client { tiling } = window.window_decorations() else {
		return None;
	};
	let size = window.viewport_size();
	let (x, y) = (f32::from(position.x), f32::from(position.y));
	let (width, height) = (f32::from(size.width), f32::from(size.height));
	// The shadow, past the window's edge.
	let top = !tiling.top && y < INSET;
	let bottom = !tiling.bottom && y > height - INSET;
	let left = !tiling.left && x < INSET;
	let right = !tiling.right && x > width - INSET;
	// Near a corner along either edge is the corner.
	let corner = INSET + CORNER;
	let (toward_left, toward_right) = (x < corner, x > width - corner);
	let (toward_top, toward_bottom) = (y < corner, y > height - corner);
	Some(match (top, bottom, left, right) {
		(true, _, _, _) if toward_left && !tiling.left => ResizeEdge::TopLeft,
		(true, _, _, _) if toward_right && !tiling.right => ResizeEdge::TopRight,
		(_, true, _, _) if toward_left && !tiling.left => ResizeEdge::BottomLeft,
		(_, true, _, _) if toward_right && !tiling.right => ResizeEdge::BottomRight,
		(_, _, true, _) if toward_top && !tiling.top => ResizeEdge::TopLeft,
		(_, _, true, _) if toward_bottom && !tiling.bottom => ResizeEdge::BottomLeft,
		(_, _, _, true) if toward_top && !tiling.top => ResizeEdge::TopRight,
		(_, _, _, true) if toward_bottom && !tiling.bottom => ResizeEdge::BottomRight,
		(true, _, _, _) => ResizeEdge::Top,
		(_, true, _, _) => ResizeEdge::Bottom,
		(_, _, true, _) => ResizeEdge::Left,
		(_, _, _, true) => ResizeEdge::Right,
		_ => return None,
	})
}

/// The pointer for resizing by `edge`.
pub fn resize_cursor(edge: ResizeEdge) -> CursorStyle {
	match edge {
		ResizeEdge::Top | ResizeEdge::Bottom => CursorStyle::ResizeUpDown,
		ResizeEdge::Left | ResizeEdge::Right => CursorStyle::ResizeLeftRight,
		ResizeEdge::TopLeft | ResizeEdge::BottomRight => CursorStyle::ResizeUpLeftDownRight,
		ResizeEdge::TopRight | ResizeEdge::BottomLeft => CursorStyle::ResizeUpRightDownLeft,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn button_layouts() {
		use Control::*;
		let layout = ButtonLayout::parse("appmenu:minimize,maximize,close");
		assert_eq!(layout.left, vec![]);
		assert_eq!(layout.right, vec![Minimize, Maximize, Close]);
		// GNOME's own default.
		assert_eq!(ButtonLayout::parse("appmenu:close").right, vec![Close]);
		let layout = ButtonLayout::parse("close,minimize, maximize:icon");
		assert_eq!(layout.left, vec![Close, Minimize, Maximize]);
		assert_eq!(layout.right, vec![]);
		assert_eq!(ButtonLayout::parse("").right, vec![]);
	}
}
