// The app's typeface: Inter, as the Electron app's is, built into the binary
// so it's the same on every platform. The files in `fonts/` are Inter 4.1's
// static ones (SIL Open Font License, see `fonts/LICENSE.txt`), one per
// weight the app sets anything in, since gpui picks a weight from a family's
// faces and can't ask a variable font for one.

use gpui::{App, Font, FontFeatures, FontStyle, FontWeight};
use std::borrow::Cow;
use std::sync::Arc;

pub fn register(cx: &mut App) {
	let fonts: [&'static [u8]; 4] = [
		// Light is the About window's.
		include_bytes!("fonts/Inter-Light.ttf"),
		include_bytes!("fonts/Inter-Regular.ttf"),
		include_bytes!("fonts/Inter-Medium.ttf"),
		include_bytes!("fonts/Inter-SemiBold.ttf"),
	];
	cx.text_system()
		.add_fonts(fonts.into_iter().map(Cow::Borrowed).collect())
		.expect("the fonts are built in");
}

/// Inter at its regular weight, for the top of anything with text in it.
/// Whatever's inside sets its own weight.
pub fn inter() -> Font {
	Font {
		family: "Inter".into(),
		// The alternates the Electron app turns on: open digits, a
		// single-storey a, and a lowercase l with a tail.
		features: FontFeatures(Arc::new(vec![
			("ss01".into(), 1),
			("cv05".into(), 1),
			("cv11".into(), 1),
		])),
		fallbacks: None,
		weight: FontWeight::NORMAL,
		style: FontStyle::Normal,
	}
}
