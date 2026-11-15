// The window's own furniture, where the app draws it: there's one title bar,
// the app's, and off macOS the buttons that close, maximize and minimize the
// window sit in it, and it's what the window is moved by.
//
// macOS puts its traffic lights in the app's bar. Windows hides its title bar
// and is told which parts of ours stand for it (`WindowControlArea`), so
// snapping, the buttons, and dragging are still its own doing. On Linux the
// app asks to decorate its own windows, and then does all of it: moving,
// resizing by the edges, and the buttons. A desktop that decorates the window
// anyway is left to, and the app's bar goes without a title or buttons, so
// there's never two of either.

use crate::controls::icon;
use gpui::{
	AnyElement, CursorStyle, Decorations, Div, Hsla, MouseButton, MouseDownEvent, Pixels, Point,
	ResizeEdge, Stateful, Window, WindowControlArea, div, prelude::*, px, rgb, white,
};

// How near an edge of the window a press resizes it, and how far along from
// a corner it's still the corner.
const EDGE: f32 = 6.;
const CORNER: f32 = 16.;

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
	caption_button("close", "x", WindowControlArea::Close, color, hover)
		.when(!cfg!(windows), |button| {
			button.on_click(|_, window, _| window.remove_window())
		})
}

/// Whether `window` gets a close button of the app's.
pub fn draws_close_button(window: &Window) -> bool {
	draws_buttons(window)
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
/// itself, and isn't maximized, full screen, or tiled along that edge.
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
	let top = !tiling.top && y < EDGE;
	let bottom = !tiling.bottom && y > height - EDGE;
	let left = !tiling.left && x < EDGE;
	let right = !tiling.right && x > width - EDGE;
	// Near a corner along either edge is the corner.
	let (toward_left, toward_right) = (x < CORNER, x > width - CORNER);
	let (toward_top, toward_bottom) = (y < CORNER, y > height - CORNER);
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
