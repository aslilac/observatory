// What shows in place of a scan's results: how far along it is while it
// runs, and what went wrong if it couldn't.
//
// While it runs it's the screen its results will be, filling in: a circle
// with a wedge for each folder in what's being scanned, growing as more is
// found there, beside a list of them. Of a whole disk, the circle is how much
// the disk says is on it, so the wedges grow into it and a ring around says
// how far along that is. Of a folder, nobody knows how much there is until
// it's all read, so the wedges share the circle by what's been found so far,
// and the ring only turns.

use crate::controls::{ButtonKind, button};
use crate::palette::{Palette, hsla};
use crate::shapes::{band, circle, filled, ring};
use crate::workspace::Workspace;
use gpui::{AnyElement, Context, Div, FontWeight, Hsla, Window, canvas, div, prelude::*, px};
use observatory_core::color::{Kind, sunburst_color};
use observatory_core::format::{compact_number, grouped, readable_size, rounded_size};
use observatory_core::scans::{Progress, ScanInfo};
use observatory_core::{ScanErrorKind, TopState};
use std::time::Duration;

const PICTURE: f32 = 340.;
// How long the arc takes to go round.
const TURN_SECONDS: f32 = 1.2;
// How long a scan shows nothing of what it's found: its first moments are
// when that changes fastest, and a scan that's over by then never has to
// show any of it.
const HOLD: Duration = Duration::from_millis(2500);
// The space between two wedges, in turns.
const GAP: f32 = 0.0015;

// The color of the `at`th of a scan's `of` folders. They're spread around
// the hues in the order they're listed in; the colors its results will have
// go by sizes that aren't known yet.
fn top_color(at: usize, of: usize, state: TopState, p: &Palette) -> Hsla {
	let hue = (at as f64 + 0.5) / of.max(1) as f64 * 360.;
	let mut color = hsla(sunburst_color(hue, 0, Kind::Directory, p.dark));
	if state == TopState::Reading {
		color.a = 0.6;
	}
	color
}

// "1:12", of how long a scan's been going.
fn clock(elapsed: Duration) -> String {
	let seconds = elapsed.as_secs();
	format!("{}:{:02}", seconds / 60, seconds % 60)
}

// A row of the list: a dot, a name, and what there is to say of it.
fn row(dot: Hsla, name: impl IntoElement, says: impl IntoElement) -> Div {
	div()
		.flex()
		.flex_none()
		.items_center()
		.gap(px(8.))
		.h(px(28.))
		.text_size(px(13.))
		.child(div().flex_none().size(px(8.)).rounded_full().bg(dot))
		.child(div().flex_1().min_w_0().truncate().child(name))
		.child(div().flex_none().text_size(px(12.)).child(says))
}

impl Workspace {
	pub fn render_scanning(
		&self,
		scan: &ScanInfo,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> AnyElement {
		let p = self.palette;
		let path = scan.path.clone();
		let cancel = button("cancel-scan", "Cancel scan", ButtonKind::Default, true, &p)
			.on_click(cx.listener(move |this, _, window, cx| {
				this.scans.cancel(&path);
				this.go_home(window, cx);
			}))
			.into_any_element();

		let count = self
			.progress
			.as_ref()
			.map_or(0, |progress| progress.counts.total_entries());
		let current = self
			.progress
			.as_ref()
			.and_then(|progress| progress.current_path.clone());
		let elapsed = self.scan_shown.map(|shown| shown.elapsed());
		// What's been found, once it's past its first moments.
		let filling: Option<&Progress> = self
			.progress
			.as_ref()
			.filter(|_| elapsed.is_some_and(|elapsed| elapsed >= HOLD));
		// How much the disk says is on it, if it's a whole disk.
		let of = self
			.drives
			.iter()
			.find(|drive| drive.mount_path == scan.path)
			.and_then(|drive| drive.usage)
			.map(|usage| usage.used)
			.filter(|used| *used > 0);
		let found = filling.map_or(0, Progress::found);
		// Never all of it until it's done: the disk's count and the scan's
		// don't agree to the byte.
		let part = of.map(|of| (found as f32 / of as f32).min(0.99));

		let gray = hsla(sunburst_color(0.0, 0, Kind::Reserved, p.dark));
		let mut wedges: Vec<(f32, f32, Hsla)> = Vec::new();
		if let Some(progress) = filling {
			let whole = of.map_or(found, |of| of.max(found)).max(1) as f32;
			let mut at = 0.;
			let mut wedge = |size: u64, color: Hsla| {
				let share = size as f32 / whole;
				if share > 0. {
					wedges.push((at, at + share, color));
				}
				at += share;
			};
			let tops = &progress.tops;
			for (i, top) in tops.iter().enumerate() {
				wedge(top.size, top_color(i, tops.len(), top.state, &p));
			}
			// The files in the folder itself, last and in gray.
			wedge(progress.loose, gray);
		}

		let turns = (self.epoch.elapsed().as_secs_f32() / TURN_SECONDS).fract();
		let (big, small) = match (filling, part) {
			(None, _) if count > 0 => (compact_number(count), "items".to_string()),
			(None, _) => (String::new(), "indexing".to_string()),
			(Some(_), Some(part)) => (
				format!("{}%", (part * 100.) as u32),
				format!("of {}", rounded_size(of.unwrap_or(0))),
			),
			(Some(_), None) => (readable_size(found), "so far".to_string()),
		};
		let picture = div()
			.relative()
			.flex_none()
			.size(px(PICTURE))
			.child(
				canvas(
					|_, _, _| (),
					move |bounds, _, window, _| {
						let center = bounds.center();
						let arc = match part {
							Some(part) => band(center, 138.5, 141.5, 0., part),
							None => band(center, 138.5, 141.5, turns, turns + 0.22),
						};
						let mut shapes =
							vec![(ring(center, 139., 141.), p.line), (vec![arc], p.default)];
						for &(from, to, color) in &wedges {
							let (from, to) = if to - from > GAP * 3. {
								(from + GAP, to - GAP)
							} else {
								(from, to)
							};
							shapes.push((vec![band(center, 56., 124., from, to)], color));
						}
						shapes.push((vec![circle(center, 50.)], p.default));
						for (outlines, color) in shapes {
							if let Some(path) = filled(&outlines) {
								window.paint_path(path, color);
							}
						}
						// It turns for as long as it's showing.
						window.request_animation_frame();
					},
				)
				.absolute()
				.size_full(),
			)
			.child(
				div()
					.absolute()
					.size_full()
					.flex()
					.flex_col()
					.items_center()
					.justify_center()
					.text_color(p.background)
					.when(!big.is_empty(), |this| {
						this.child(
							div()
								.text_size(px(if big.len() > 5 { 15. } else { 21. }))
								.line_height(px(26.))
								.font_weight(FontWeight::SEMIBOLD)
								.child(big),
						)
					})
					.child(div().text_size(px(10.)).opacity(0.6).child(small)),
			);

		let name = self.root_name(&scan.path);
		let rows: Vec<Div> = match filling {
			// Places for what's coming.
			None => (0..6)
				.map(|i| {
					let bar = |width: f32| div().h(px(8.)).w(px(width)).rounded(px(4.)).bg(p.fill);
					row(p.line, bar(110. - (i * 37 % 60) as f32), bar(44.))
				})
				.collect(),
			Some(progress) => {
				let tops = &progress.tops;
				let mut rows: Vec<Div> = tops
					.iter()
					.enumerate()
					// A folder that turned out to have nothing in it (or
					// that the scan doesn't go into) isn't worth a row.
					.filter(|(_, top)| top.state != TopState::Done || top.size > 0)
					.map(|(i, top)| {
						let color = top_color(i, tops.len(), top.state, &p);
						match top.state {
							TopState::Waiting => {
								row(p.line, top.name.clone(), "waiting").text_color(p.faint)
							}
							TopState::Reading => row(
								color,
								top.name.clone(),
								div()
									.text_color(p.muted)
									.child(format!("{}…", readable_size(top.size))),
							),
							TopState::Done => row(color, top.name.clone(), readable_size(top.size)),
						}
					})
					.collect();
				if progress.loose > 0 {
					rows.push(row(
						gray,
						div().text_color(p.muted).child("Files"),
						readable_size(progress.loose),
					));
				}
				rows
			}
		};
		let list = div()
			.flex_1()
			.min_w_0()
			.min_h_0()
			.flex()
			.flex_col()
			.pt(px(28.))
			.pr(px(18.))
			.pb(px(16.))
			.pl(px(8.))
			.child(
				div()
					.flex()
					.flex_none()
					.items_baseline()
					.justify_between()
					.gap(px(12.))
					.pb(px(8.))
					.mb(px(4.))
					.border_b_1()
					.border_color(p.line)
					.child(
						div()
							.min_w_0()
							.truncate()
							.text_size(px(14.))
							.font_weight(FontWeight::SEMIBOLD)
							.child(name),
					)
					.child(
						div()
							.flex_none()
							.text_size(px(12.))
							.text_color(p.muted)
							.children(filling.map(|_| match of {
								Some(of) => {
									format!("{} of {}", readable_size(found), rounded_size(of))
								}
								None => format!("{} so far", readable_size(found)),
							})),
					),
			)
			.child(
				div()
					.id("scan-tops")
					.flex_1()
					.min_h_0()
					.flex()
					.flex_col()
					.overflow_y_scroll()
					.children(rows),
			)
			.child(
				div()
					.flex()
					.flex_none()
					.justify_between()
					.mt(px(8.))
					.pt(px(10.))
					.border_t_1()
					.border_dashed()
					.border_color(p.line)
					.text_size(px(11.))
					.text_color(p.muted)
					.child(if count > 0 {
						format!("{} items", grouped(count))
					} else {
						"indexing".to_string()
					})
					.children(elapsed.map(clock)),
			);

		div()
			.flex()
			.flex_col()
			.size_full()
			.child(self.render_toolbar(Some(cancel), Vec::new(), window, cx))
			.child(
				div()
					.flex_1()
					.min_h_0()
					.flex()
					.child(
						div()
							.w(gpui::relative(0.59))
							.min_w_0()
							.flex()
							.flex_col()
							.items_center()
							.justify_center()
							.gap(px(6.))
							.child(picture)
							.child(
								div()
									.h(px(15.))
									.max_w_full()
									.px(px(24.))
									.truncate()
									.text_size(px(11.))
									.line_height(px(15.))
									.text_color(p.muted)
									.children(current),
							),
					)
					.child(list),
			)
			.into_any_element()
	}

	pub fn render_failed(
		&self,
		scan: &ScanInfo,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> AnyElement {
		let p = self.palette;
		let root = self.root_name(&scan.path);
		let kind = scan.error.as_ref().map(|error| &error.kind);
		let (title, detail) = match kind {
			Some(ScanErrorKind::Missing) => (
				format!("“{root}” couldn't be found"),
				"It may have been moved, renamed, or deleted, or it's on a drive that isn't \
				 connected right now.",
			),
			Some(ScanErrorKind::Permission | ScanErrorKind::Protected | ScanErrorKind::Admin) => (
				format!("Observatory can't read “{root}”"),
				if cfg!(target_os = "macos") {
					"Grant Observatory access in System Settings → Privacy & Security → Files \
					 and Folders (or Full Disk Access), then try again."
				} else {
					"Your account doesn't have permission to read this folder."
				},
			),
			_ => (
				format!("Couldn't scan “{root}”"),
				"Something went wrong reading this folder.",
			),
		};
		let path = scan.path.clone();
		let chips = Vec::new();
		div()
			.flex()
			.flex_col()
			.size_full()
			.child(self.render_toolbar(None, chips, window, cx))
			.child(
				div()
					.flex_1()
					.min_h_0()
					.flex()
					.flex_col()
					.items_center()
					.justify_center()
					.gap(px(10.))
					.p(px(32.))
					.child(
						div()
							.text_size(px(16.))
							.font_weight(FontWeight::SEMIBOLD)
							.child(title),
					)
					.child(
						div()
							.max_w(px(420.))
							.text_center()
							.text_color(p.muted)
							.child(detail),
					)
					.child(
						div()
							.max_w(px(560.))
							.truncate()
							.text_size(px(11.))
							.text_color(p.faint)
							.child(scan.path.clone()),
					)
					.child(
						button("try-again", "Try again", ButtonKind::Primary, false, &p)
							.mt(px(10.))
							.on_click(cx.listener(move |this, _, window, cx| {
								this.rescan(&path, window, cx)
							})),
					),
			)
			.into_any_element()
	}
}
