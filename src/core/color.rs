// Colors, as sRGB, for whatever draws them: the desktop app hands them to
// the GPU, and a terminal would write them out as 24-bit escapes or pixels.

/// An sRGB color, each channel 0 to 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color {
	pub r: f32,
	pub g: f32,
	pub b: f32,
}

impl Color {
	pub const WHITE: Color = Color::hex(0xffffff);
	pub const BLACK: Color = Color::hex(0x000000);

	pub const fn hex(rgb: u32) -> Self {
		Self {
			r: ((rgb >> 16) & 0xff) as f32 / 255.0,
			g: ((rgb >> 8) & 0xff) as f32 / 255.0,
			b: (rgb & 0xff) as f32 / 255.0,
		}
	}

	/// A color given the way the palette is written: OKLCH, with the hue in
	/// degrees. Whatever falls outside sRGB is clipped, as browsers do.
	pub fn oklch(l: f64, c: f64, h: f64) -> Self {
		let (a, b) = (c * h.to_radians().cos(), c * h.to_radians().sin());
		let l_ = (l + 0.3963377774 * a + 0.2158037573 * b).powi(3);
		let m_ = (l - 0.1055613458 * a - 0.0638541728 * b).powi(3);
		let s_ = (l - 0.0894841775 * a - 1.2914855480 * b).powi(3);
		Self {
			r: encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
			g: encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
			b: encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_),
		}
	}

	/// This color, `t` of the way to `other`.
	pub fn mix(self, other: Color, t: f32) -> Self {
		Self {
			r: self.r + (other.r - self.r) * t,
			g: self.g + (other.g - self.g) * t,
			b: self.b + (other.b - self.b) * t,
		}
	}

	pub fn to_rgb8(self) -> [u8; 3] {
		[self.r, self.g, self.b].map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
	}
}

// Linear light to sRGB's transfer curve.
fn encode(linear: f64) -> f32 {
	let v = linear.clamp(0.0, 1.0);
	let v = if v <= 0.0031308 {
		12.92 * v
	} else {
		1.055 * v.powf(1.0 / 2.4) - 0.055
	};
	v as f32
}

/// What a wedge of the sunburst, or a dot in the legend, stands for.
/// `Imaginary` is the rest of a folder, too small to draw one by one, and
/// `Reserved` is what Windows keeps for itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
	Directory,
	File,
	Imaginary,
	Reserved,
}

// Hue placement is anchored to the scan root, not the current view: the root
// owns the full 0..360 range, and every directory splits its own range among
// its children in proportion to their sizes, largest first (scan order).
// Because each child's share of its parent's range equals its share of the
// parent's bytes, a node's range works out to its byte offset within the
// root over the root's size, which is what `start` / `size` are here (both
// fractions of the root). The hue sits at the midpoint of that range, so any
// given file or folder keeps the same hue wherever the sunburst is centered.
pub fn hue_for_range(start: f64, size: f64) -> f64 {
	(start + size / 2.0) * 360.0
}

/// Hues for the immediate children of a directory that begins at `start`
/// (a fraction of the root: `RenderTree::position`), one per size, in scan
/// order. Empty if the root is.
pub fn hues_by_position(sizes: impl Iterator<Item = u64>, start: f64, root_size: u64) -> Vec<f64> {
	if root_size == 0 {
		return Vec::new();
	}
	let mut pos = start;
	sizes
		.map(|size| {
			let size = size as f64 / root_size as f64;
			let hue = hue_for_range(pos, size);
			pos += size;
			hue
		})
		.collect()
}

// Color for a sunburst arc (and the matching legend dots). Like the hue,
// `depth` is measured from the scan root rather than the current view, so a
// node looks identical wherever the sunburst is centered. Deeper folders
// recede toward the background (lighter on the light theme, darker on the
// dark one), and files are always the color they recede toward, at any
// depth. `Imaginary` and `Reserved` are both gray, the reserved one a step
// stronger, since it's space that's taken rather than a remainder.
pub fn sunburst_color(hue: f64, depth: usize, kind: Kind, dark: bool) -> Color {
	match kind {
		Kind::Imaginary if dark => Color::oklch(0.28, 0.015, 287.0),
		Kind::Imaginary => Color::oklch(0.92, 0.012, 287.0),
		Kind::Reserved if dark => Color::oklch(0.42, 0.012, 287.0),
		Kind::Reserved => Color::oklch(0.8, 0.01, 287.0),
		Kind::Directory | Kind::File => {
			// Files skip straight to where folders are headed.
			let steps = if kind == Kind::File {
				f64::INFINITY
			} else {
				depth as f64
			};
			let (l, c) = if dark {
				(recede(0.84, 0.68, steps), recede(0.18, 0.1, steps))
			} else {
				(recede(0.68, 0.9, steps), recede(0.22, 0.09, steps))
			};
			Color::oklch(l, c, hue)
		}
	}
}

// Move from `near` toward `far` as depth grows, closing a fifth of the
// remaining gap per level. Depth is unbounded, so a linear ramp would clamp
// and wash out everything past a few levels; this keeps adjacent levels
// distinguishable however far the user has drilled in.
fn recede(near: f64, far: f64, depth: f64) -> f64 {
	far + (near - far) * 0.8f64.powf(depth)
}

/// The app's palette: background-and-default with no accent.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Theme {
	pub dark: bool,
	pub background: Color,
	pub default: Color,
	pub muted: Color,
	pub faint: Color,
	pub line: Color,
	pub line_soft: Color,
	pub fill: Color,
	pub fill_strong: Color,
	// How full a volume is, on its usage bar: plenty of room, under 15%
	// free, under 5% free.
	pub meter: Color,
	pub meter_low: Color,
	pub meter_critical: Color,
	// Inline-only danger; never used for hover/focus.
	pub danger_bg: Color,
	pub danger_fg: Color,
	pub danger_border: Color,
	// Behind white text, on a button that deletes.
	pub danger_solid: Color,
}

impl Theme {
	pub fn light() -> Self {
		Self {
			dark: false,
			background: Color::hex(0xf9f9fd),
			default: Color::hex(0x191923),
			muted: Color::hex(0x6c6b81),
			faint: Color::hex(0x9898ac),
			line: Color::hex(0xd5d4e3),
			line_soft: Color::hex(0xe4e4ee),
			fill: Color::hex(0xededf6),
			fill_strong: Color::hex(0xe2e2ee),
			meter: Color::oklch(0.6, 0.17, 258.0),
			meter_low: Color::oklch(0.72, 0.17, 60.0),
			meter_critical: Color::oklch(0.6, 0.21, 27.0),
			danger_bg: Color::hex(0xfff5f4),
			danger_fg: Color::hex(0x7a1f1c),
			danger_border: Color::hex(0xf2cbc7),
			danger_solid: Color::oklch(0.56, 0.19, 27.0),
		}
	}

	pub fn dark() -> Self {
		Self {
			dark: true,
			background: Color::hex(0x1a1a24),
			default: Color::hex(0xececf2),
			muted: Color::hex(0x9696aa),
			faint: Color::hex(0x5b5a6d),
			line: Color::hex(0x373647),
			line_soft: Color::hex(0x282734),
			fill: Color::hex(0x282734),
			fill_strong: Color::hex(0x333243),
			meter: Color::oklch(0.68, 0.15, 258.0),
			meter_low: Color::oklch(0.78, 0.15, 65.0),
			meter_critical: Color::oklch(0.68, 0.19, 25.0),
			danger_bg: Color::hex(0x2a1715),
			danger_fg: Color::hex(0xff9b96),
			danger_border: Color::hex(0x5c2b28),
			danger_solid: Color::oklch(0.58, 0.18, 27.0),
		}
	}

	pub fn named(dark: bool) -> Self {
		if dark { Self::dark() } else { Self::light() }
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn oklch_matches_css() {
		// sRGB's own red and blue, as CSS writes them in OKLCH.
		assert_eq!(
			Color::oklch(0.627955, 0.257683, 29.2339).to_rgb8(),
			[255, 0, 0]
		);
		assert_eq!(
			Color::oklch(0.452014, 0.313214, 264.052).to_rgb8(),
			[0, 0, 255]
		);
		assert_eq!(Color::oklch(1.0, 0.0, 0.0).to_rgb8(), [255, 255, 255]);
		assert_eq!(Color::oklch(0.0, 0.0, 0.0).to_rgb8(), [0, 0, 0]);
	}

	#[test]
	fn hues_follow_bytes() {
		let hues = hues_by_position([50, 30, 20].into_iter(), 0.0, 100);
		assert_eq!(hues, vec![90.0, 234.0, 324.0]);
		assert!(hues_by_position([1].into_iter(), 0.0, 0).is_empty());
	}

	#[test]
	fn files_are_where_folders_recede_to() {
		let file = sunburst_color(120.0, 0, Kind::File, false);
		let deep = sunburst_color(120.0, 60, Kind::Directory, false);
		assert_eq!(file.to_rgb8(), deep.to_rgb8());
	}
}
