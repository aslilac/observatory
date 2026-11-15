// The sunburst, painted. Its shape, its moves from one folder to the next,
// and what's under a point are all `observatory_core::sunburst`'s; this asks
// it for each frame and fills the wedges.

use crate::cleanup::draggable;
use crate::palette::hsla;
use crate::popup::item_menu;
use crate::shapes::{circle, filled};
use crate::workspace::{Hover, Workspace};
use gpui::{
	AnyElement, Bounds, ClickEvent, Context, Edges, Font, FontWeight, Hsla, MouseButton,
	MouseDownEvent, MouseMoveEvent, Pixels, Point, SharedString, TextRun, anchored, canvas,
	deferred, div, point, prelude::*, px,
};
use observatory_core::color::{Color, Kind};
use observatory_core::format::readable_size;
use observatory_core::sunburst::{CENTER_RADIUS, Hit, Sweep, VIEW_RADIUS, Wedge, outline};
use std::f32::consts::TAU;
use std::time::Instant;

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

impl Workspace {
	fn sunburst_hit(&self, position: Point<Pixels>) -> Option<Hit> {
		let (center, scale) = placed(self.sunburst_bounds);
		if scale <= 0. {
			return None;
		}
		let x = f32::from(position.x - center.x) / scale;
		let y = f32::from(position.y - center.y) / scale;
		self.sunburst.hit(x as f64, y as f64)
	}

	fn hovered_wedge(&self) -> Option<&Wedge> {
		match self.hover?.hit {
			Hit::Wedge(index) => self.sunburst.wedges().get(index),
			Hit::Center => None,
		}
	}

	pub fn render_sunburst(&mut self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let frame = self.sunburst.frame(self.epoch.elapsed());
		let animating = self.sunburst.animating();
		let hovered = match self.hover.map(|hover| hover.hit) {
			Some(Hit::Wedge(index)) => Some(index),
			_ => None,
		};
		// 0 to 1 and back, once a pulse.
		let pulse = {
			let phase = (self.hover_since.elapsed().as_secs_f32() / PULSE_SECONDS).fract();
			0.5 - 0.5 * (phase * TAU).cos()
		};
		let wedges = self.sunburst.wedges();
		let shapes: Vec<(Sweep, Hsla)> = frame
			.iter()
			.map(|drawn| {
				let mut fill = drawn.fill;
				let mut opacity = drawn.opacity as f32;
				if let Some(wedge) = drawn.wedge.and_then(|index| wedges.get(index)) {
					// What's queued for cleanup is on its way out.
					let queued = wedge
						.cleanup_path
						.as_deref()
						.is_some_and(|path| self.store.in_cleanup(path));
					if queued {
						opacity *= 0.3;
					}
					if drawn.wedge == hovered {
						fill = fill.mix(Color::WHITE, 0.22 * pulse);
						opacity *= 1.0 - 0.15 * pulse;
					}
				}
				let mut color = hsla(fill);
				color.a = opacity;
				(drawn.sweep, color)
			})
			.collect();

		let size = self.tree.as_ref().map_or(0, |tree| tree.size);
		let can_go_up = !self.cursor().is_empty();
		let wedge = self.hovered_wedge();
		let clickable = match self.hover.map(|hover| hover.hit) {
			Some(Hit::Center) => can_go_up,
			Some(Hit::Wedge(_)) => wedge.is_some_and(|wedge| wedge.item.is_some()),
			None => false,
		};
		let dragged = wedge
			.and_then(|wedge| wedge.item.as_ref())
			.map(|item| self.dragged_with(item));
		let tooltip = self.render_sunburst_tooltip();
		// How big the folder is, in the middle. It's painted with the wedges,
		// not laid out over them, so it's sized by the sunburst it's in
		// rather than by where the last frame's was.
		let label: SharedString = readable_size(size).into();
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
			// Where it's drawn is where the pointer is looked up.
			move |bounds, _, cx| workspace.update(cx, |this, _| this.sunburst_bounds = bounds),
			move |bounds, _, window, cx| {
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
				if animating || hovered.is_some() {
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
				let hover = this.sunburst_hit(event.position).map(|hit| Hover {
					hit,
					position: event.position,
				});
				if hover.map(|hover| hover.hit) != this.hover.map(|hover| hover.hit) {
					this.hover_since = Instant::now();
				}
				if hover != this.hover {
					this.hover = hover;
					cx.notify();
				}
			}))
			.on_hover(cx.listener(|this, over: &bool, _, cx| {
				if !over && this.hover.take().is_some() {
					cx.notify();
				}
			}))
			.on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
				match this.sunburst_hit(event.position()) {
					Some(Hit::Center) => this.up(window, cx),
					Some(Hit::Wedge(index)) => {
						let Some(wedge) = this.sunburst.wedges().get(index) else {
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
					let item = match this.sunburst_hit(event.position) {
						Some(Hit::Wedge(index)) => this
							.sunburst
							.wedges()
							.get(index)
							.and_then(|wedge| wedge.item.clone()),
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

	// What the wedge under the pointer is: its name and size, and for a
	// folder, the biggest things in it.
	fn render_sunburst_tooltip(&self) -> Option<AnyElement> {
		let p = self.palette;
		let hover = self.hover?;
		let wedge = self.hovered_wedge()?;
		if self.popup.is_some() {
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
					.position(hover.position + point(px(15.), px(5.)))
					.snap_to_window_with_margin(Edges::all(px(8.)))
					.child(tip),
			)
			.with_priority(2)
			.into_any_element(),
		)
	}
}
