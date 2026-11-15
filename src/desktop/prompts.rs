// The two things the app asks before it scans: on macOS, the first time,
// whether to give it Full Disk Access; and whether a path that was pasted
// into the window is one to scan.

use crate::controls::{ButtonKind, button, modal_card, scrim};
use crate::window_frame::ALL_CORNERS;
use crate::workspace::Workspace;
use gpui::{AnyElement, Context, FontWeight, MouseButton, div, prelude::*, px};
use observatory_core::access::FULL_DISK_ACCESS_SETTINGS;
use std::path::Path;

pub enum Ask {
	/// Before the first scan (of this path), without Full Disk Access.
	FullDiskAccess(String),
	/// A path was pasted. `problem` is why it can't be scanned, if it
	/// can't.
	Paste {
		path: String,
		problem: Option<&'static str>,
	},
}

// Whether pasted text reads as a path: absolute, from the home folder, or
// from a drive letter.
fn looks_like_path(text: &str) -> bool {
	let bytes = text.as_bytes();
	text.starts_with('/')
		|| text.starts_with('~')
		|| (bytes.len() >= 3
			&& bytes[0].is_ascii_alphabetic()
			&& bytes[1] == b':'
			&& (bytes[2] == b'\\' || bytes[2] == b'/'))
}

impl Workspace {
	/// Text was pasted into the window (not into a field): if it's a path,
	/// offers to scan it.
	pub fn pasted(&mut self, text: &str, cx: &mut Context<Self>) {
		let text = text.trim();
		if self.ask.is_some() || text.contains('\n') || !looks_like_path(text) {
			return;
		}
		let path = match (text.strip_prefix('~'), dirs_home()) {
			(Some(rest), Some(home)) => format!("{home}{rest}"),
			_ => text.to_string(),
		};
		let problem = match std::fs::metadata(Path::new(&path)) {
			Ok(found) if found.is_dir() => None,
			Ok(_) => Some("That path isn't a directory."),
			Err(_) => Some("Couldn't find that path on disk."),
		};
		self.ask = Some(Ask::Paste { path, problem });
		cx.notify();
	}

	pub fn render_ask(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		let p = self.palette;
		let card = match self.ask.as_ref()? {
			Ask::FullDiskAccess(_) => modal_card(440., &p)
				.child(
					div()
						.mb(px(12.))
						.text_size(px(16.))
						.font_weight(FontWeight::SEMIBOLD)
						.child("Give Observatory Full Disk Access?"),
				)
				.child(div().text_color(p.muted).child(
					"macOS keeps apps out of Mail, Messages, Safari, and other apps' data \
					 unless you give them Full Disk Access. Without it, those folders are \
					 left out of the scan, and what it finds comes up short.",
				))
				.child(
					div()
						.mt(px(8.))
						.text_color(p.muted)
						.child("Turn Observatory on in the list, then reopen it when macOS asks."),
				)
				.child(
					div()
						.mt(px(20.))
						.flex()
						.justify_end()
						.gap(px(8.))
						.child(
							button(
								"fda-skip",
								"Scan without it",
								ButtonKind::Default,
								false,
								&p,
							)
							.on_click(cx.listener(|this, _, window, cx| {
								// Asked and answered: it doesn't ask again.
								this.store.set_full_disk_access_asked();
								if let Some(Ask::FullDiskAccess(path)) = this.ask.take() {
									this.open_now(&path, window, cx);
								}
							})),
						)
						.child(
							button(
								"fda-grant",
								"Open System Settings",
								ButtonKind::Primary,
								false,
								&p,
							)
							.on_click(cx.listener(|this, _, _, cx| {
								// Granting it takes a restart, which macOS
								// offers, so the scan waits.
								this.store.set_full_disk_access_asked();
								this.ask = None;
								cx.open_url(FULL_DISK_ACCESS_SETTINGS);
								cx.notify();
							})),
						),
				),
			Ask::Paste { path, problem } => modal_card(440., &p)
				.child(
					div()
						.mb(px(12.))
						.text_size(px(16.))
						.font_weight(FontWeight::SEMIBOLD)
						.child("Scan this folder?"),
				)
				.child(
					div()
						.px(px(10.))
						.py(px(8.))
						.rounded(px(6.))
						.bg(p.fill)
						.text_size(px(12.))
						.child(path.clone()),
				)
				.when_some(*problem, |this, problem| {
					this.child(
						div()
							.mt(px(8.))
							.text_size(px(12.))
							.text_color(p.danger_fg)
							.child(problem),
					)
				})
				.child(
					div()
						.mt(px(20.))
						.flex()
						.justify_end()
						.gap(px(8.))
						.child(
							button("paste-cancel", "Cancel", ButtonKind::Default, false, &p)
								.on_click(cx.listener(|this, _, _, cx| {
									this.ask = None;
									cx.notify();
								})),
						)
						.when(problem.is_none(), |this| {
							this.child(
								button("paste-scan", "Scan", ButtonKind::Primary, false, &p)
									.on_click(cx.listener(|this, _, window, cx| {
										if let Some(Ask::Paste { path, .. }) = this.ask.take() {
											this.open(&path, window, cx);
										}
									})),
							)
						}),
				),
		};
		// Escape, or a click outside: neither scans nor answers, so the
		// next scan asks again.
		Some(
			self.frame
				.round(scrim(&p), &ALL_CORNERS)
				.on_mouse_down(
					MouseButton::Left,
					cx.listener(|this, _, _, cx| {
						this.ask = None;
						cx.notify();
					}),
				)
				.child(card)
				.into_any_element(),
		)
	}
}

fn dirs_home() -> Option<String> {
	std::env::home_dir().map(|home| home.to_string_lossy().into_owned())
}
