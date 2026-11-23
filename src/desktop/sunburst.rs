// The sunburst, painted. Its shape, its moves from one folder to the next,
// and what's under a point are all `observatory_core::sunburst`'s; this asks
// it for each frame and fills the wedges.

use crate::cleanup::draggable;
use crate::inspect::Inspect;
use crate::palette::hsla;
use crate::popup::{OpenMenu, item_menu};
use crate::shapes::{circle, filled};
use crate::workspace::Workspace;
use gpui::{
	AnyElement, Bounds, ClickEvent, Context, Edges, Font, FontWeight, Hsla, MouseButton,
	MouseDownEvent, MouseMoveEvent, Pixels, Point, SharedString, TextRun, anchored, canvas,
	deferred, div, point, prelude::*, px,
};
use observatory_core::color::{Color, Kind};
use observatory_core::format::readable_size;
use observatory_core::sunburst::{
	CENTER_RADIUS, Hit, Sunburst as Transition, Sweep, VIEW_RADIUS, View, Wedge, outline,
};
use std::f32::consts::TAU;
use std::time::{Duration, Instant};

// How long the wedge under the pointer takes to brighten and settle again.
const PULSE_SECONDS: f32 = 1.4;
// How many of a folder's children its tooltip names.
const TOOLTIP_CHILDREN: usize = 7;

// Where the sunburst sits in `bounds`: its center, and how many pixels one
// of its units is.
fn placed(bounds: Bounds<Pixels>) -> (Point<Pixels>, f32) {
	let side = f32::from(bounds.size.width.min(bounds.size.height));
	(bounds.center(), side / (2.0 * VIEW_RADIUS as f32))
}

/// The sunburst on screen: the wedges it's showing or moving to, where they
/// were last drawn, and where the pointer is among them.
pub struct Sunburst {
	transition: Transition,
	// Where it was last drawn, for finding what the pointer's on.
	bounds: Bounds<Pixels>,
	pub pointer: Pointer,
}

/// Where the pointer is, as the sunburst sees it.
#[derive(Clone, Copy, PartialEq)]
pub enum Pointer {
	/// Not on anything of it.
	Away,
	/// On the circle in the middle, which goes up a folder.
	Center,
	Wedge(Hovered),
}

/// The wedge the pointer's on.
#[derive(Clone, Copy, PartialEq)]
pub struct Hovered {
	/// Which of the sunburst's wedges it is.
	index: usize,
	/// Where the pointer is, which its tooltip follows.
	position: Point<Pixels>,
	/// When the pointer came onto it, which its pulse counts from.
	since: Instant,
}

impl Sunburst {
	pub fn new() -> Self {
		Self {
			transition: Transition::new(),
			bounds: Bounds::default(),
			pointer: Pointer::Away,
		}
	}

	/// Shows `wedges`, the `view`'s, moving to them from whatever's showing
	/// (or with `still`, changing where they are).
	pub fn show(&mut self, view: View, wedges: Vec<Wedge>, now: Duration, still: bool) {
		self.transition.show(view, wedges, now, still);
	}

	fn wedge(&self, index: usize) -> Option<&Wedge> {
		self.transition.wedges().get(index)
	}

	// What's under `position`, a point of the window.
	fn hit(&self, position: Point<Pixels>) -> Option<Hit> {
		let (center, scale) = placed(self.bounds);
		if scale <= 0. {
			return None;
		}
		let x = f32::from(position.x - center.x) / scale;
		let y = f32::from(position.y - center.y) / scale;
		self.transition.hit(x as f64, y as f64)
	}

	// The pointer's at `position`. Says whether that's anywhere new.
	fn point_at(&mut self, position: Point<Pixels>) -> bool {
		let pointer = match (self.hit(position), self.pointer) {
			(None, _) => Pointer::Away,
			(Some(Hit::Center), _) => Pointer::Center,
			// Still on the wedge it was on, whose pulse carries on.
			(Some(Hit::Wedge(index)), Pointer::Wedge(hovered)) if hovered.index == index => {
				Pointer::Wedge(Hovered {
					position,
					..hovered
				})
			}
			(Some(Hit::Wedge(index)), _) => Pointer::Wedge(Hovered {
				index,
				position,
				since: Instant::now(),
			}),
		};
		let moved = pointer != self.pointer;
		self.pointer = pointer;
		moved
	}

	// What to fill at `now`, back to front. `queued` says whether a path is
	// in cleanup.
	fn shapes(&mut self, now: Duration, queued: impl Fn(&str) -> bool) -> Vec<(Sweep, Hsla)> {
		let frame = self.transition.frame(now);
		let wedges = self.transition.wedges();
		// The wedge under the pointer, and how far through a pulse it is: 0
		// to 1 and back.
		let hovered = match self.pointer {
			Pointer::Wedge(hovered) => {
				let phase = (hovered.since.elapsed().as_secs_f32() / PULSE_SECONDS).fract();
				Some((hovered.index, 0.5 - 0.5 * (phase * TAU).cos()))
			}
			Pointer::Away | Pointer::Center => None,
		};
		frame
			.iter()
			.map(|drawn| {
				let mut fill = drawn.fill;
				let mut opacity = drawn.opacity as f32;
				if let Some(index) = drawn.wedge
					&& let Some(wedge) = wedges.get(index)
				{
					// What's queued for cleanup is on its way out.
					if wedge.cleanup_path.as_deref().is_some_and(&queued) {
						opacity *= 0.3;
					}
					if let Some((hovered, pulse)) = hovered
						&& hovered == index
					{
						fill = fill.mix(Color::WHITE, 0.22 * pulse);
						opacity *= 1.0 - 0.15 * pulse;
					}
				}
				let mut color = hsla(fill);
				color.a = opacity;
				(drawn.sweep, color)
			})
			.collect()
	}

	// Whether it'll look different a frame from now.
	fn moving(&self) -> bool {
		self.transition.animating() || matches!(self.pointer, Pointer::Wedge(_))
	}
}

impl Workspace {
	pub fn render_sunburst(&self, inspect: &Inspect, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let sunburst = &inspect.sunburst;
		// What a press where the pointer is would do, what a drag from there
		// would carry, and what there is to say of it.
		let (clickable, dragged, tooltip) = match sunburst.pointer {
			Pointer::Away => (false, None, None),
			Pointer::Center => (!inspect.tree.cursor.is_empty(), None, None),
			Pointer::Wedge(hovered) => match sunburst.wedge(hovered.index) {
				Some(wedge) => (
					wedge.item.is_some(),
					wedge.item.as_ref().map(|item| inspect.dragged_with(item)),
					self.render_sunburst_tooltip(wedge, hovered.position),
				),
				None => (false, None, None),
			},
		};
		// How big the folder is, in the middle. It's painted with the wedges,
		// not laid out over them, so it's sized by the sunburst it's in
		// rather than by where the last frame's was.
		let label: SharedString = readable_size(inspect.tree.size).into();
		let label_run = TextRun {
			len: label.len(),
			font: Font {
				weight: FontWeight::SEMIBOLD,
				..crate::fonts::inter()
			},
			color: p.background,
			background_color: None,
			underline: None,
			strikethrough: None,
		};

		let workspace = cx.entity();
		let center_color = p.default;
		let painting = canvas(
			// Where it's drawn is where the pointer is looked up, and what's
			// drawn is the wedges as they are by now.
			move |bounds, _, cx| {
				workspace.update(cx, |this, _| {
					let now = this.epoch.elapsed();
					let Some((root, inspect)) = this.screen.inspecting_mut() else {
						return (Vec::new(), false);
					};
					let sunburst = &mut inspect.sunburst;
					sunburst.bounds = bounds;
					let shapes = sunburst.shapes(now, |path| this.store.in_cleanup(root, path));
					(shapes, sunburst.moving())
				})
			},
			move |bounds, (shapes, moving), window, cx| {
				let (center, scale) = placed(bounds);
				if scale <= 0. {
					return;
				}
				let to_window =
					|(x, y): (f32, f32)| point(center.x + px(x * scale), center.y + px(y * scale));
				// Straight edges stay within a quarter pixel of the curves.
				let tolerance = 0.25 / scale as f64;
				for (sweep, color) in &shapes {
					let outlines: Vec<Vec<Point<Pixels>>> = outline(*sweep, tolerance)
						.into_iter()
						.map(|shape| shape.into_iter().map(to_window).collect())
						.collect();
					if let Some(path) = filled(&outlines) {
						window.paint_path(path, *color);
					}
				}
				let middle = circle(center, CENTER_RADIUS as f32 * scale);
				if let Some(path) = filled(&[middle]) {
					window.paint_path(path, center_color);
				}
				let font_size = px((17.0 * scale).clamp(11., 22.));
				let line = window.text_system().shape_line(
					label.clone(),
					font_size,
					std::slice::from_ref(&label_run),
					None,
				);
				let line_height = font_size * 1.2;
				let origin = point(center.x - line.width / 2., center.y - line_height / 2.);
				let _ = line.paint(origin, line_height, window, cx);
				if moving {
					window.request_animation_frame();
				}
			},
		)
		.absolute()
		.size_full();

		div()
			.id("sunburst")
			.relative()
			.flex_1()
			.min_w_0()
			.min_h_0()
			.when(clickable, |this| this.cursor_pointer())
			.child(painting)
			.children(tooltip)
			.on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
				if let Some((_, inspect)) = this.screen.inspecting_mut()
					&& inspect.sunburst.point_at(event.position)
				{
					cx.notify();
				}
			}))
			.on_hover(cx.listener(|this, over: &bool, _, cx| {
				if !over
					&& let Some((_, inspect)) = this.screen.inspecting_mut()
					&& inspect.sunburst.pointer != Pointer::Away
				{
					inspect.sunburst.pointer = Pointer::Away;
					cx.notify();
				}
			}))
			.on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
				let Some((_, inspect)) = this.screen.inspecting() else {
					return;
				};
				let sunburst = &inspect.sunburst;
				match sunburst.hit(event.position()) {
					Some(Hit::Center) => this.up(window, cx),
					Some(Hit::Wedge(index)) => {
						let Some(wedge) = sunburst.wedge(index) else {
							return;
						};
						if wedge.kind == Kind::Directory && !wedge.path.is_empty() {
							let into = wedge.path.clone();
							this.enter(&into, window, cx);
						}
					}
					None => {}
				}
			}))
			.on_mouse_down(
				MouseButton::Right,
				cx.listener(|this, event: &MouseDownEvent, _, cx| {
					let Some((_, inspect)) = this.screen.inspecting() else {
						return;
					};
					let sunburst = &inspect.sunburst;
					let item = match sunburst.hit(event.position) {
						Some(Hit::Wedge(index)) => {
							sunburst.wedge(index).and_then(|wedge| wedge.item.clone())
						}
						_ => None,
					};
					if let Some(item) = item {
						this.show_popup(event.position, item_menu(&item), cx);
					}
				}),
			)
			.when_some(dragged, |this, items| draggable(this, items, p))
			.into_any_element()
	}

	// What `wedge`, the one under the pointer at `position`, is: its name
	// and size, and for a folder, the biggest things in it.
	fn render_sunburst_tooltip(
		&self,
		wedge: &Wedge,
		position: Point<Pixels>,
	) -> Option<AnyElement> {
		let p = self.palette;
		// A menu that's up at the pointer is in its place.
		if let Some(OpenMenu::At(_)) = self.menu {
			return None;
		}
		let node = &wedge.node;
		let mut tip = div()
			.min_w(px(180.))
			.max_w(px(320.))
			.px(px(16.))
			.py(px(12.))
			.rounded(px(8.))
			.bg(p.default)
			.text_color(p.background)
			.text_size(px(12.))
			.shadow_lg()
			.child(
				div()
					.font_weight(FontWeight::SEMIBOLD)
					.child(match &wedge.reserved {
						Some(group) => group.label.to_string(),
						None => node.name.clone(),
					}),
			)
			.child(div().opacity(0.8).child(readable_size(node.size)));
		if let Some(group) = &wedge.reserved {
			tip = tip.child(
				div()
					.mt(px(6.))
					.max_w(px(260.))
					.text_size(px(11.))
					.line_height(px(15.))
					.child(div().opacity(0.8).child(group.names.join(", ")))
					.child(group.hint),
			);
		} else if node.directory && !node.files.is_empty() {
			let children = node.files.iter().take(TOOLTIP_CHILDREN).map(|child| {
				div()
					.flex()
					.justify_between()
					.gap(px(16.))
					.child(div().min_w_0().truncate().child(child.name.clone()))
					.child(
						div()
							.flex_none()
							.opacity(0.8)
							.child(readable_size(child.size)),
					)
			});
			tip = tip.child(
				div()
					.mt(px(8.))
					.flex()
					.flex_col()
					.text_size(px(11.))
					.line_height(px(16.))
					.children(children),
			);
		}
		Some(
			deferred(
				anchored()
					.position(position + point(px(15.), px(5.)))
					.snap_to_window_with_margin(Edges::all(px(8.) + self.frame.margin()))
					.child(tip),
			)
			.with_priority(2)
			.into_any_element(),
		)
	}
}
