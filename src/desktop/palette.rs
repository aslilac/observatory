// The core's palette, as the colors gpui draws with.

use gpui::{Hsla, Rgba};
use observatory_core::color::{Color, Theme};

pub fn hsla(color: Color) -> Hsla {
	Rgba {
		r: color.r,
		g: color.g,
		b: color.b,
		a: 1.0,
	}
	.into()
}

/// `Theme`, field for field.
#[derive(Clone, Copy)]
pub struct Palette {
	pub dark: bool,
	pub background: Hsla,
	pub default: Hsla,
	pub muted: Hsla,
	pub faint: Hsla,
	pub line: Hsla,
	pub line_soft: Hsla,
	pub fill: Hsla,
	pub fill_strong: Hsla,
	pub meter: Hsla,
	pub meter_low: Hsla,
	pub meter_critical: Hsla,
	pub danger_bg: Hsla,
	pub danger_fg: Hsla,
	pub danger_border: Hsla,
	pub danger_solid: Hsla,
	/// What dims the window behind a modal.
	pub scrim: Hsla,
}

impl Palette {
	pub fn named(dark: bool) -> Self {
		let theme = Theme::named(dark);
		Self {
			dark,
			background: hsla(theme.background),
			default: hsla(theme.default),
			muted: hsla(theme.muted),
			faint: hsla(theme.faint),
			line: hsla(theme.line),
			line_soft: hsla(theme.line_soft),
			fill: hsla(theme.fill),
			fill_strong: hsla(theme.fill_strong),
			meter: hsla(theme.meter),
			meter_low: hsla(theme.meter_low),
			meter_critical: hsla(theme.meter_critical),
			danger_bg: hsla(theme.danger_bg),
			danger_fg: hsla(theme.danger_fg),
			danger_border: hsla(theme.danger_border),
			danger_solid: hsla(theme.danger_solid),
			scrim: gpui::black().opacity(if dark { 0.55 } else { 0.35 }),
		}
	}
}
