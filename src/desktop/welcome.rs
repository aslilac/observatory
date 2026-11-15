// The first screen: the disks there are to scan, and the folders that have
// been.

use crate::controls::{eyebrow, icon};
use crate::popup::place_menu;
use crate::workspace::Workspace;
use gpui::{AnyElement, Context, FontWeight, MouseButton, MouseDownEvent, div, prelude::*, px};
use observatory_core::drives::{Usage, place_name};
use observatory_core::format::{describe_drive, readable_size};
use observatory_core::scans::Status;
use std::path::Path;

const METER_WIDTH: f32 = 200.;

// One row of a section: an icon in a tile, what it is, and how full.
struct Row {
	icon: &'static str,
	// The "open a folder" row's tile is an outline, since nothing's there yet.
	dashed: bool,
	title: String,
	detail: String,
	meta: Option<AnyElement>,
}

impl Workspace {
	pub fn render_welcome(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;

		let disks: Vec<AnyElement> = self
			.drives
			.iter()
			.enumerate()
			.map(|(index, drive)| {
				let path = drive.mount_path.clone();
				let rescan = self.has_result(&path);
				let row = Row {
					icon: if drive.network {
						"server"
					} else {
						"hard-drive"
					},
					dashed: false,
					title: drive.title(),
					detail: describe_drive(drive),
					meta: self.render_usage(&path, drive.usage, false),
				};
				let menu_path = path.clone();
				self.render_row(("disk", index), row)
					.on_click(cx.listener(move |this, _, window, cx| this.open(&path, window, cx)))
					.on_mouse_down(
						MouseButton::Right,
						cx.listener(move |this, event: &MouseDownEvent, _, cx| {
							this.show_popup(
								event.position,
								place_menu(&menu_path, rescan, false),
								cx,
							)
						}),
					)
					.into_any_element()
			})
			.collect();

		let mut folders = vec![
			self.render_row(
				"open-folder",
				Row {
					icon: "folder-open",
					dashed: true,
					title: "Open a folder…".into(),
					detail: "or drop one onto this window, or paste its path".into(),
					meta: Some(
						div()
							.px(px(6.))
							.py(px(1.))
							.rounded(px(4.))
							.border_1()
							.border_color(p.line)
							.text_size(px(11.))
							.text_color(p.muted)
							.child(if cfg!(target_os = "macos") {
								"⌘O"
							} else {
								"Ctrl+O"
							})
							.into_any_element(),
					),
				},
			)
			.on_click(cx.listener(|this, _, window, cx| this.choose_folder(window, cx)))
			.into_any_element(),
		];
		// A recent that isn't there any more (moved, or on a disk that's not
		// plugged in) is left out, though it's kept in case it comes back.
		let recents = self
			.store
			.recent_scans()
			.iter()
			.filter(|recent| Path::new(&recent.path).is_dir())
			.enumerate();
		for (index, recent) in recents {
			let path = recent.path.clone();
			let rescan = self.has_result(&path);
			let row = Row {
				icon: "folder",
				dashed: false,
				title: place_name(&self.drives, &path),
				detail: path.clone(),
				meta: self.render_usage(&path, self.recent_usage.get(&path).copied(), true),
			};
			let menu_path = path.clone();
			folders.push(
				self.render_row(("recent", index), row)
					.on_click(cx.listener(move |this, _, window, cx| this.open(&path, window, cx)))
					.on_mouse_down(
						MouseButton::Right,
						cx.listener(move |this, event: &MouseDownEvent, _, cx| {
							this.show_popup(
								event.position,
								place_menu(&menu_path, rescan, true),
								cx,
							)
						}),
					)
					.into_any_element(),
			);
		}

		let chips = vec![self.render_cleanup_chip(cx)];
		div()
			.flex()
			.flex_col()
			.size_full()
			.child(self.render_toolbar(None, chips, cx))
			.child(
				div()
					.id("welcome")
					.flex_1()
					.min_h_0()
					.overflow_y_scroll()
					.child(
						div()
							.mx_auto()
							.w_full()
							.max_w(px(1280.))
							.p(px(32.))
							.flex()
							.flex_col()
							.gap(px(28.))
							.when(!disks.is_empty(), |this| {
								this.child(self.render_section("DISKS", disks))
							})
							.child(self.render_section("FOLDERS", folders)),
					),
			)
			.into_any_element()
	}

	// Whether there's a scan of `path` that Rescan would replace.
	fn has_result(&self, path: &str) -> bool {
		self.scan(path)
			.is_some_and(|scan| scan.status != Status::Building)
	}

	fn render_section(&self, title: &'static str, rows: Vec<AnyElement>) -> AnyElement {
		let p = self.palette;
		let mut card = div()
			.flex()
			.flex_col()
			.rounded(px(8.))
			.border_1()
			.border_color(p.line)
			.overflow_hidden();
		for (index, row) in rows.into_iter().enumerate() {
			if index > 0 {
				card = card.child(div().h(px(1.)).bg(p.line_soft));
			}
			card = card.child(row);
		}
		div()
			.flex()
			.flex_col()
			.gap(px(8.))
			.child(eyebrow(title, &p))
			.child(card)
			.into_any_element()
	}

	fn render_row(&self, id: impl Into<gpui::ElementId>, row: Row) -> gpui::Stateful<gpui::Div> {
		let p = self.palette;
		div()
			.id(id)
			.flex()
			.items_center()
			.gap(px(12.))
			.px(px(12.))
			.py(px(9.))
			.cursor_pointer()
			.hover(move |style| style.bg(p.fill))
			.child(
				div()
					.flex()
					.flex_none()
					.items_center()
					.justify_center()
					.size(px(32.))
					.rounded(px(6.))
					.map(|this| {
						if row.dashed {
							// In the color the Electron app's is: `line` is too
							// faint for the dashes to read as an outline.
							this.border_1().border_dashed().border_color(p.faint)
						} else {
							this.bg(p.fill)
						}
					})
					.child(icon(row.icon, 16., p.muted)),
			)
			.child(
				div()
					.flex_1()
					.min_w_0()
					.flex()
					.flex_col()
					.child(
						div()
							.truncate()
							.font_weight(FontWeight::MEDIUM)
							.child(row.title),
					)
					.child(
						div()
							.truncate()
							.text_size(px(11.))
							.line_height(px(15.))
							.text_color(p.muted)
							.child(row.detail),
					),
			)
			.children(row.meta)
	}

	// How a place is doing: what a scan of it found (or that one's running),
	// and how full its volume is. `free` is for a folder, where what matters
	// about the volume is the room left on it.
	fn render_usage(&self, path: &str, volume: Option<Usage>, free: bool) -> Option<AnyElement> {
		let p = self.palette;
		let scan = self.scan(path);
		let scanned = scan
			.filter(|scan| scan.status == Status::Complete)
			.and_then(|scan| scan.size);
		let status = match scan.map(|scan| scan.status) {
			Some(Status::Building) => Some(div().text_color(p.muted).child("Scanning…")),
			Some(Status::Complete) => scanned.map(|size| div().child(readable_size(size))),
			_ => None,
		};
		let Some(volume) = volume.filter(|volume| volume.total > 0) else {
			return status.map(|status| status.text_size(px(12.)).into_any_element());
		};

		let total = volume.total as f32;
		let room = volume.available as f32 / total;
		let color = if room < 0.05 {
			p.meter_critical
		} else if room < 0.15 {
			p.meter_low
		} else {
			p.meter
		};
		let used = (volume.used as f32 / total).clamp(0., 1.) * METER_WIDTH;
		// What the scan found is drawn solid, in front of everything used,
		// which is fainter where the two are told apart.
		let found = scanned.map(|size| ((size as f32 / total).min(1.) * METER_WIDTH).max(3.));
		let of_volume = if free {
			format!("{} free", readable_size(volume.available))
		} else {
			format!(
				"{} of {}",
				readable_size(volume.used),
				readable_size(volume.total)
			)
		};
		Some(
			div()
				.flex()
				.flex_none()
				.flex_col()
				.items_end()
				.gap(px(5.))
				.w(px(METER_WIDTH))
				.child(
					div()
						.flex()
						.gap(px(4.))
						.text_size(px(11.))
						.line_height(px(15.))
						.children(status.map(|status| status.font_weight(FontWeight::MEDIUM)))
						.child(div().text_color(p.muted).child(if scan.is_some() {
							format!("· {of_volume}")
						} else {
							of_volume
						})),
				)
				.child(
					div()
						.relative()
						.w_full()
						.h(px(4.))
						.rounded_full()
						.bg(p.fill_strong)
						.overflow_hidden()
						.child(
							div()
								.absolute()
								.left_0()
								.top_0()
								.h_full()
								.w(px(used))
								.rounded_full()
								.bg(color)
								.when(free || found.is_some(), |this| this.opacity(0.4)),
						)
						.children(found.map(|found| {
							div()
								.absolute()
								.left_0()
								.top_0()
								.h_full()
								.w(px(found))
								.rounded_full()
								.bg(color)
						})),
				)
				.into_any_element(),
		)
	}
}
