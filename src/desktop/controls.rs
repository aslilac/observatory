// The small things every screen is made of: icons, buttons, checkboxes, the
// toolbar's chips, and the card a modal sits in.

use crate::palette::Palette;
use gpui::{
	AnyView, App, Context, Div, ElementId, FontWeight, Hsla, SharedString, Stateful, Svg, Window,
	div, prelude::*, px, svg, white,
};

/// One of the icons in `icons/`, by lucide's name for it.
pub fn icon(name: &str, size: f32, color: Hsla) -> Svg {
	svg()
		.path(SharedString::from(format!("icons/{name}.svg")))
		.size(px(size))
		.flex_none()
		.text_color(color)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ButtonKind {
	Default,
	/// The one to press.
	Primary,
	/// The one that deletes.
	Danger,
}

pub fn button(
	id: impl Into<ElementId>,
	label: impl Into<SharedString>,
	kind: ButtonKind,
	small: bool,
	p: &Palette,
) -> Stateful<Div> {
	let base = div()
		.id(id)
		.flex()
		.flex_none()
		.items_center()
		.justify_center()
		.rounded(px(6.))
		.cursor_pointer()
		.text_size(px(if small { 12. } else { 13. }))
		.font_weight(FontWeight::MEDIUM)
		.h(px(if small { 26. } else { 30. }))
		.px(px(if small { 10. } else { 14. }))
		.child(label.into());
	let fill = p.fill;
	match kind {
		ButtonKind::Default => base
			.border_1()
			.border_color(p.line)
			.bg(p.background)
			.text_color(p.default)
			.hover(move |style| style.bg(fill)),
		ButtonKind::Primary => base
			.bg(p.default)
			.text_color(p.background)
			.hover(|style| style.opacity(0.88)),
		ButtonKind::Danger => base
			.bg(p.danger_solid)
			.text_color(white())
			.hover(|style| style.opacity(0.88)),
	}
}

/// A checkbox, as drawn; whoever puts it in a row says what a click does.
pub fn checkbox(id: impl Into<ElementId>, checked: bool, p: &Palette) -> Stateful<Div> {
	let default = p.default;
	div()
		.id(id)
		.flex()
		.flex_none()
		.items_center()
		.justify_center()
		.size(px(14.))
		.rounded(px(4.))
		.border_1()
		.cursor_pointer()
		.map(|this| {
			if checked {
				this.bg(p.default)
					.border_color(p.default)
					.child(icon("check", 10., p.background))
			} else {
				this.border_color(p.line)
					.hover(move |style| style.border_color(default))
			}
		})
}

/// One of the toolbar's pills (issues, cleanup).
pub fn chip(id: impl Into<ElementId>, p: &Palette) -> Stateful<Div> {
	let fill = p.fill;
	div()
		.id(id)
		.flex()
		.flex_none()
		.items_center()
		.gap(px(6.))
		.h(px(26.))
		.px(px(10.))
		.rounded_full()
		.border_1()
		.border_color(p.line)
		.text_size(px(12.))
		.cursor_pointer()
		.hover(move |style| style.bg(fill))
}

/// A square button with only an icon in it.
pub fn icon_button(
	id: impl Into<ElementId>,
	name: &str,
	enabled: bool,
	p: &Palette,
) -> Stateful<Div> {
	let fill = p.fill;
	div()
		.id(id)
		.flex()
		.flex_none()
		.items_center()
		.justify_center()
		.size(px(26.))
		.rounded(px(6.))
		.child(icon(name, 15., if enabled { p.muted } else { p.faint }))
		.when(enabled, |this| {
			this.cursor_pointer().hover(move |style| style.bg(fill))
		})
}

/// What dims the window behind a modal, and takes the clicks meant for what's
/// under it. The card goes in as its child.
pub fn scrim(p: &Palette) -> Div {
	div()
		.absolute()
		.inset_0()
		.flex()
		.items_center()
		.justify_center()
		.bg(p.scrim)
		.occlude()
}

/// The card a modal's content sits in.
pub fn modal_card(width: f32, p: &Palette) -> Div {
	div()
		.w(px(width))
		.max_w_full()
		.p(px(24.))
		.rounded(px(12.))
		.bg(p.background)
		.border_1()
		.border_color(p.line)
		.shadow_lg()
		.text_color(p.default)
		.text_size(px(13.))
		// Clicks in the card aren't clicks on the scrim around it.
		.on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
}

// What comes up when the pointer rests on something that has more to say.
struct Tip(&'static str);

impl Render for Tip {
	fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		div()
			.px(px(8.))
			.py(px(4.))
			.rounded(px(6.))
			.bg(gpui::black().opacity(0.85))
			.text_color(white())
			.text_size(px(11.))
			.child(self.0)
	}
}

/// A tooltip that says `text`, for `.tooltip()`.
pub fn tip(text: &'static str) -> impl Fn(&mut Window, &mut App) -> AnyView {
	move |_, cx| cx.new(|_| Tip(text)).into()
}

/// The small-caps heading over a section.
pub fn eyebrow(text: &'static str, p: &Palette) -> Div {
	div()
		.text_size(px(10.))
		.font_weight(FontWeight::SEMIBOLD)
		.text_color(p.muted)
		.child(text)
}
