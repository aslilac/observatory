// What shows in place of a scan's results: how far along it is while it
// runs, and what went wrong if it couldn't.

use crate::controls::{ButtonKind, button};
use crate::shapes::{band, circle, filled, ring};
use crate::workspace::Workspace;
use gpui::{AnyElement, Context, FontWeight, canvas, div, prelude::*, px};
use observatory_core::ScanErrorKind;
use observatory_core::format::compact_number;
use observatory_core::paths::basename;
use observatory_core::scans::ScanInfo;

const SPINNER: f32 = 260.;
// How long the arc takes to go round.
const TURN_SECONDS: f32 = 1.2;

impl Workspace {
	pub fn render_scanning(&self, scan: &ScanInfo, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let path = scan.path.clone();
		let cancel = button("cancel-scan", "Cancel scan", ButtonKind::Default, true, &p)
			.on_click(cx.listener(move |this, _, window, cx| {
				this.scans.cancel(&path);
				this.go_home(window, cx);
			}))
			.into_any_element();
		let chips = vec![self.render_cleanup_chip(cx)];

		let count = self
			.progress
			.as_ref()
			.map_or(0, |progress| progress.counts.total_entries());
		let current = self
			.progress
			.as_ref()
			.and_then(|progress| progress.current_path.clone());
		let turns = (self.epoch.elapsed().as_secs_f32() / TURN_SECONDS).fract();

		let spinner = div()
			.relative()
			.flex_none()
			.size(px(SPINNER))
			.child(
				canvas(
					|_, _, _| (),
					move |bounds, _, window, _| {
						let center = bounds.center();
						let shapes = [
							(ring(center, 117., 119.), p.line),
							(
								vec![band(center, 115., 121., turns, turns + 0.25)],
								p.default,
							),
							(vec![circle(center, 62.)], p.default),
						];
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
					.when(count > 0, |this| {
						this.child(
							div()
								.text_size(px(24.))
								.line_height(px(28.))
								.font_weight(FontWeight::SEMIBOLD)
								.child(compact_number(count)),
						)
					})
					.child(div().text_size(px(11.)).child(if count > 0 {
						"items"
					} else {
						"indexing"
					})),
			);

		div()
			.flex()
			.flex_col()
			.size_full()
			.child(self.render_toolbar(Some(cancel), chips, cx))
			.child(
				div()
					.flex_1()
					.min_h_0()
					.flex()
					.flex_col()
					.items_center()
					.justify_center()
					.gap(px(6.))
					.child(spinner)
					.child(
						div()
							.mt(px(14.))
							.text_size(px(16.))
							.font_weight(FontWeight::SEMIBOLD)
							.child(root_name(&scan.path)),
					)
					.child(
						div()
							.h(px(15.))
							.max_w(px(560.))
							.px(px(24.))
							.truncate()
							.text_size(px(11.))
							.line_height(px(15.))
							.text_color(p.muted)
							.children(current.map(|path| format!("indexing {path}"))),
					),
			)
			.into_any_element()
	}

	pub fn render_failed(&self, scan: &ScanInfo, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let root = root_name(&scan.path);
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
		let chips = vec![self.render_cleanup_chip(cx)];
		div()
			.flex()
			.flex_col()
			.size_full()
			.child(self.render_toolbar(None, chips, cx))
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

// What a scan's root is called before there's a tree to say: the folder's
// name, or the path itself for a disk.
fn root_name(path: &str) -> String {
	match basename(path) {
		"" => path.to_string(),
		name => name.to_string(),
	}
}
