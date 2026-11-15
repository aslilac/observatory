// The About window: the site's hero in small. The render of the observatory
// sits across the bottom, on the site's sunset, under star trails turning
// around the pole, with what this copy is and what it's on listed over the
// sky. The sky is `observatory_core::sky`'s, a picture it works out again
// every so often as the stars turn; this puts it behind everything else.

use crate::menus::{REPOSITORY, environment};
use crate::window_frame::{
	ALL_CORNERS, ButtonLayout, Control, Frame as WindowFrame, HEADER_BAR, SHADOW_ROOM,
	close_button, draws_close_button,
};
use gpui::{
	App, Bounds, ClipboardItem, Context, Corner, FontWeight, Global, Hsla, MouseButton,
	MouseDownEvent, ObjectFit, Pixels, RenderImage, SharedString, TitlebarOptions, Window,
	WindowBounds, WindowControlArea, WindowDecorations, WindowHandle, WindowOptions, canvas, div,
	img, linear_color_stop, linear_gradient, prelude::*, px, rgb, rgba, size,
};
use image::{Frame, RgbaImage};
use observatory_core::sky::{Ellipse, Order, Sky, scene_height};
use smallvec::smallvec;
use std::sync::Arc;
use std::time::{Duration, Instant};

const WIDTH: f32 = 480.;
// The scene keeps to the bottom, and the sky grows for each line of the
// list.
const HEIGHT: f32 = 560.;
const LINE: f32 = 20.;

// Anticlockwise, as around the north pole, once in eight minutes.
const TURN: Duration = Duration::from_secs(480);
// How long between pictures of the sky. The stars move a few pixels a
// second at most, so this is as smooth as it needs to be; behind another
// window, it only keeps up.
const FRAME: Duration = Duration::from_millis(100);
const FRAME_BEHIND: Duration = Duration::from_millis(500);

const WEBSITE: &str = "https://mckayla.dev/observatory/";
const ISSUES: &str = "https://github.com/aslilac/observatory/issues";
const AUTHOR: &str = "https://mckayla.dev";

// The one About window, if it's open.
#[derive(Default)]
struct Opened(Option<WindowHandle<About>>);

impl Global for Opened {}

/// Opens the About window, or brings it forward.
pub fn open(cx: &mut App) {
	let opened = cx.try_global::<Opened>().and_then(|opened| opened.0);
	if let Some(window) = opened
		&& window
			.update(cx, |_, window, _| window.activate_window())
			.is_ok()
	{
		return;
	}
	let details = environment();
	// The version has a line of its own, under the name.
	let lines = details.len().saturating_sub(1) as f32;
	// With room for its shadow, where it has one.
	let bounds = Bounds::centered(
		None,
		size(
			px(WIDTH + SHADOW_ROOM),
			px(HEIGHT + LINE * lines + SHADOW_ROOM),
		),
		cx,
	);
	let window = cx
		.open_window(
			WindowOptions {
				window_bounds: Some(WindowBounds::Windowed(bounds)),
				titlebar: Some(TitlebarOptions {
					title: Some("About Observatory".into()),
					appears_transparent: true,
					traffic_light_position: None,
				}),
				// No title bar but what the app draws, which here is only
				// the button that closes it (see window_frame.rs).
				window_decorations: Some(WindowDecorations::Client),
				is_resizable: false,
				is_minimizable: false,
				..Default::default()
			},
			|window, cx| cx.new(|cx| About::new(details, window, cx)),
		)
		.ok();
	cx.set_global(Opened(window));
}

// What a sky is of: the window's size, how many pixels to each of its own,
// and where the words are.
type SkyKey = (f32, f32, f32, Option<Ellipse>);

struct About {
	details: Vec<(&'static str, String)>,
	// Where the words were last drawn, which the stars dim behind.
	words: Option<Bounds<Pixels>>,
	sky: Option<(SkyKey, Arc<Sky>)>,
	picture: Option<Arc<RenderImage>>,
	opened: Instant,
	copied: bool,
}

impl About {
	fn new(
		details: Vec<(&'static str, String)>,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> Self {
		// The sky, for as long as the window's there: each picture is worked
		// out off to the side, then swapped in for the last.
		cx.spawn_in(window, async move |this, cx| {
			loop {
				let Ok((key, sky, turns)) = this.update_in(cx, |this, window, _| {
					let key = this.sky_key(window);
					let sky = this
						.sky
						.as_ref()
						.filter(|(of, _)| *of == key)
						.map(|(_, sky)| sky.clone());
					let turns = this.opened.elapsed().as_secs_f32() / TURN.as_secs_f32();
					(key, sky, turns)
				}) else {
					break;
				};
				let (sky, picture) = cx
					.background_executor()
					.spawn(async move {
						let sky = sky.unwrap_or_else(|| {
							let (width, height, scale, words) = key;
							Arc::new(Sky::new(width, height, scale, words))
						});
						let picture = picture_of(&sky, turns);
						(sky, picture)
					})
					.await;
				let Ok(in_front) = this.update_in(cx, |this, window, cx| {
					this.sky = Some((key, sky));
					if let Some(last) = std::mem::replace(&mut this.picture, picture) {
						window.drop_image(last).ok();
					}
					cx.notify();
					window.is_window_active()
				}) else {
					break;
				};
				cx.background_executor()
					.timer(if in_front { FRAME } else { FRAME_BEHIND })
					.await;
			}
		})
		.detach();

		Self {
			details,
			words: None,
			sky: None,
			picture: None,
			opened: Instant::now(),
			copied: false,
		}
	}

	fn sky_key(&self, window: &Window) -> SkyKey {
		let frame = WindowFrame::read(window);
		let viewport = frame.inner(window.viewport_size());
		// The stars dim in an ellipse around the words, a little short of
		// their corners.
		let words = self.words.map(|words| {
			let center = words.center() - frame.origin();
			Ellipse {
				x: center.x.into(),
				y: center.y.into(),
				rx: 0.9 * f32::from(words.size.width),
				ry: 0.85 * f32::from(words.size.height),
			}
		});
		(
			viewport.width.into(),
			viewport.height.into(),
			window.scale_factor(),
			words,
		)
	}

	fn copy(&mut self, cx: &mut Context<Self>) {
		// As it'd go in a bug report.
		let text = self
			.details
			.iter()
			.map(|(label, value)| format!("{label}: {value}"))
			.collect::<Vec<_>>()
			.join("\n");
		cx.write_to_clipboard(ClipboardItem::new_string(text));
		self.copied = true;
		cx.notify();
		cx.spawn(async move |this, cx| {
			cx.background_executor()
				.timer(Duration::from_millis(1500))
				.await;
			this.update(cx, |this, cx| {
				this.copied = false;
				cx.notify();
			})
			.ok();
		})
		.detach();
	}
}

// A frame of the sky, as gpui takes pictures: BGRA.
fn picture_of(sky: &Sky, turns: f32) -> Option<Arc<RenderImage>> {
	let pixels = sky.frame(turns, Order::Bgra);
	let (width, height) = sky.size();
	let picture = RgbaImage::from_raw(width as u32, height as u32, pixels)?;
	Some(Arc::new(RenderImage::new(smallvec![Frame::new(picture)])))
}

// The top of the sky, for before there's a picture of it.
const SKY: u32 = 0x0d1033;
const GROUND: u32 = 0x15151a;
const DEFAULT: u32 = 0xf1ede2;
const ACCENT: u32 = 0x9fb6ff;

fn muted() -> Hsla {
	rgba(0xf1ede2c2).into()
}

fn faint() -> Hsla {
	rgba(0xf1ede28f).into()
}

fn link(id: &'static str, label: &'static str, url: &'static str) -> impl IntoElement {
	div()
		.id(id)
		.text_color(rgb(ACCENT))
		.cursor_pointer()
		.hover(|style| style.opacity(0.75))
		.child(label)
		.occlude()
		.on_mouse_down(MouseButton::Left, press_is_mine)
		.on_click(move |_, _, cx| cx.open_url(url))
}

// A press on a link is a press on the link, not on the window behind it,
// which a press anywhere else moves.
fn press_is_mine(_: &MouseDownEvent, _: &mut Window, cx: &mut App) {
	cx.stop_propagation();
}

// Starts moving the window with the pointer, from a press anywhere in it.
// gpui does this itself on Linux, and has nothing for it on macOS, where
// AppKit will move a window by the mouse-down it's handed.
#[cfg(target_os = "macos")]
// The objc crate's macros check for a cfg that rustc has never heard of.
#[allow(unexpected_cfgs)]
fn move_window(window: &mut Window, cx: &mut App) {
	use objc::runtime::Object;
	use objc::{class, msg_send, sel, sel_impl};
	use raw_window_handle::{HasWindowHandle, RawWindowHandle};

	let Ok(handle) = HasWindowHandle::window_handle(window) else {
		return;
	};
	let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
		return;
	};
	// The press being handled right now, and the window it's in, held onto
	// until they're used.
	let (native, press) = unsafe {
		let view = handle.ns_view.as_ptr() as *mut Object;
		let native: *mut Object = msg_send![view, window];
		let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
		let press: *mut Object = msg_send![app, currentEvent];
		if native.is_null() || press.is_null() {
			return;
		}
		let _: *mut Object = msg_send![native, retain];
		let _: *mut Object = msg_send![press, retain];
		(native, press)
	};
	// AppKit follows the pointer until the button's let go, and runs the
	// app's other work while it does. That can't start from in here, in the
	// middle of gpui's own handling of the press, so it's put off a moment.
	cx.spawn(async move |_| unsafe {
		let _: () = msg_send![native, performWindowDragWithEvent: press];
		let _: () = msg_send![press, release];
		let _: () = msg_send![native, release];
	})
	.detach();
}

#[cfg(not(target_os = "macos"))]
fn move_window(window: &mut Window, _: &mut App) {
	window.start_window_move();
}

impl Render for About {
	fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		let frame = WindowFrame::of(window);
		let viewport = frame.inner(window.viewport_size());
		let version = self
			.details
			.first()
			.map(|(_, version)| version.clone())
			.unwrap_or_default();
		let dot = || div().mx(px(10.)).text_color(faint()).child("·");
		let column = |color: Hsla, texts: Vec<SharedString>| {
			div()
				.flex()
				.flex_col()
				.text_color(color)
				.children(texts.into_iter().map(|text| div().child(text)))
		};
		let rest = self.details.iter().skip(1);

		let about = cx.entity();
		let words = div()
			.absolute()
			.top(px(52.))
			.left(px(24.))
			.flex()
			.flex_col()
			.items_start()
			// Where the words are is where the stars dim.
			.child(
				canvas(
					move |bounds, _, cx| about.update(cx, |this, _| this.words = Some(bounds)),
					|_, _, _, _| {},
				)
				.absolute()
				.size_full(),
			)
			.child(
				div()
					.text_size(px(30.))
					.line_height(px(45.))
					.font_weight(FontWeight::SEMIBOLD)
					.child("Observatory"),
			)
			.child(
				div()
					.mt(px(2.))
					.mb(px(14.))
					.text_size(px(13.))
					.line_height(px(20.))
					.font_weight(FontWeight::NORMAL)
					.text_color(muted())
					.child(version),
			)
			.child(
				div()
					.mb(px(10.))
					.text_color(muted())
					.child("A cross-platform disk usage analyzer with a modern UI."),
			)
			.child(
				div()
					.flex()
					.text_size(px(14.))
					.child(link("website", "Website", WEBSITE))
					.child(dot())
					.child(link("github", "GitHub", REPOSITORY))
					.child(dot())
					.child(link("issues", "Issues", ISSUES)),
			)
			// Which build this is and what it's on, for a bug report.
			.child(
				div()
					.mt(px(22.))
					.flex()
					.gap(px(10.))
					.text_size(px(13.))
					.line_height(px(LINE))
					.font_weight(FontWeight::NORMAL)
					.child(column(
						faint(),
						rest.clone().map(|(label, _)| (*label).into()).collect(),
					))
					.child(column(
						muted(),
						rest.map(|(_, value)| value.clone().into()).collect(),
					)),
			)
			.child(
				div()
					.id("copy")
					.mt(px(10.))
					.text_size(px(13.))
					.font_weight(FontWeight::NORMAL)
					.text_color(rgb(ACCENT))
					.cursor_pointer()
					.hover(|style| style.opacity(0.75))
					.child(if self.copied { "Copied" } else { "Copy" })
					.occlude()
					.on_mouse_down(MouseButton::Left, press_is_mine)
					.on_click(cx.listener(|this, _, _, cx| this.copy(cx))),
			);

		let about = div()
			.relative()
			.size_full()
			.overflow_hidden()
			.bg(rgb(SKY))
			.text_color(rgb(DEFAULT))
			.text_size(px(15.))
			.line_height(px(22.5))
			.font(crate::fonts::inter())
			.font_weight(FontWeight::LIGHT)
			// The whole window is something to move it by, as the Electron
			// one's is, but for its links. Windows does the moving, told
			// that all of it is as good as a title bar; elsewhere a press
			// starts it.
			.when(cfg!(windows), |this| {
				this.window_control_area(WindowControlArea::Drag)
			})
			.on_mouse_down(MouseButton::Left, |_, window, cx| move_window(window, cx))
			.children(self.picture.clone().map(|picture| {
				frame.round(
					img(picture)
						.absolute()
						.top_0()
						.left_0()
						.size_full()
						.object_fit(ObjectFit::Fill),
					&ALL_CORNERS,
				)
			}))
			.child(
				frame.round(
					img("about/scene.webp")
						.absolute()
						.bottom_0()
						.left_0()
						.w_full()
						.h(px(scene_height(viewport.width.into())))
						.object_fit(ObjectFit::Fill),
					&[Corner::BottomLeft, Corner::BottomRight],
				),
			)
			// The ground runs into the dark under the copyright.
			.child(
				div()
					.map(|this| frame.round(this, &[Corner::BottomLeft, Corner::BottomRight]))
					.absolute()
					.bottom_0()
					.left_0()
					.w_full()
					.h(px(84.))
					.bg(linear_gradient(
						180.,
						linear_color_stop(rgba(0x15151a00), 0.),
						linear_color_stop(rgb(GROUND), 0.85),
					)),
			)
			.child(words)
			.child(
				div()
					.absolute()
					.left(px(24.))
					.bottom(px(20.))
					.flex()
					.gap(px(4.))
					.text_size(px(13.))
					.font_weight(FontWeight::NORMAL)
					.text_color(faint())
					.child("© 2019-2026")
					.child(link("author", "McKayla Washburn-Love", AUTHOR))
					.child("♥"),
			)
			// Off macOS, where nothing else does, the app draws the button
			// that closes the window.
			.when(draws_close_button(window), |this| {
				let button = close_button(muted(), rgba(0xffffff1f).into());
				this.child(if HEADER_BAR {
					// Round, as GNOME's are, at whichever end the desktop
					// puts the close button.
					let left = cx
						.try_global::<ButtonLayout>()
						.is_some_and(|layout| layout.left.contains(&Control::Close));
					div()
						.absolute()
						.top(px(9.))
						.when(left, |this| this.left(px(9.)))
						.when(!left, |this| this.right(px(9.)))
						.child(button)
				} else {
					div().absolute().top_0().right_0().h(px(36.)).child(button)
				})
			});
		// Inside its shadow, where it has one.
		frame.pad(div().size_full()).child(frame.window(about))
	}
}
