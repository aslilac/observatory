// What a scan couldn't read: a chip in the toolbar that says how many, and
// the modal that says which. The ones with a fix (Full Disk Access on
// macOS, an administrator on Windows) are each one issue with a button.

use crate::controls::{ButtonKind, button, chip, icon, icon_button, modal_card, scrim};
use crate::inspect::Inspect;
use crate::window_frame::ALL_CORNERS;
use crate::workspace::Workspace;
use gpui::{AnyElement, Context, FontWeight, MouseButton, div, prelude::*, px};
use observatory_core::ScanError;
use observatory_core::access::FULL_DISK_ACCESS_SETTINGS;
use observatory_core::format::grouped;
use observatory_core::issues::{LISTED_MAX, group_issues};

#[derive(Default)]
pub struct IssuesModal {
	// Whether the folders behind each of the fixable issues are listed.
	show_protected: bool,
	show_admin: bool,
	// Why restarting as an administrator didn't happen, if it didn't.
	failure: Option<String>,
}

impl Workspace {
	// The modal, while it's up.
	fn issues_mut(&mut self) -> Option<&mut IssuesModal> {
		let (_, inspect) = self.screen.inspecting_mut()?;
		inspect.issues.as_mut()
	}

	pub fn render_issues_chip(&self, root: &str, cx: &mut Context<Self>) -> Option<AnyElement> {
		let p = self.palette;
		let count = self.scans.errors(root).len();
		if count == 0 {
			return None;
		}
		Some(
			chip("issues-chip", &p)
				.child(icon("circle-alert", 13., p.muted))
				.child(grouped(count as u64))
				.on_click(cx.listener(|this, _, _, cx| {
					if let Some((_, inspect)) = this.screen.inspecting_mut() {
						inspect.issues = Some(IssuesModal::default());
					}
					cx.notify();
				}))
				.into_any_element(),
		)
	}

	// Starts the app over as an administrator, to scan `path` again. It quits
	// once Windows' prompt is answered with a yes.
	fn restart_as_admin(&mut self, path: &str, cx: &mut Context<Self>) {
		let failure = match std::env::current_exe() {
			Ok(exe) => {
				let directory = std::env::current_dir().unwrap_or_default();
				match observatory_core::admin::relaunch_elevated(
					0,
					&exe.to_string_lossy(),
					&[format!("--scan={path}")],
					&directory.to_string_lossy(),
				) {
					Ok(true) => {
						cx.quit();
						return;
					}
					// The user said no: nothing to say about it.
					Ok(false) => None,
					Err(error) => Some(error.to_string()),
				}
			}
			Err(error) => Some(error.to_string()),
		};
		if let Some(modal) = self.issues_mut() {
			modal.failure = failure;
		}
		cx.notify();
	}

	/// The modal over the scan at `root`, if it's up.
	pub fn render_issues(
		&self,
		root: &str,
		inspect: &Inspect,
		cx: &mut Context<Self>,
	) -> Option<AnyElement> {
		let p = self.palette;
		let modal = inspect.issues.as_ref()?;
		let errors = self.scans.errors(root);
		let issues = group_issues(&errors);
		let many = |count: usize, one: &str, more: &str| {
			if count == 1 {
				format!("1 {one}")
			} else {
				format!("{} {more}", grouped(count as u64))
			}
		};

		// The folders of a kind, at most `LISTED_MAX` of them.
		let list = |label: String, errors: &[&ScanError], id: usize| {
			let rows = errors.iter().take(LISTED_MAX).map(|error| {
				div()
					.px(px(10.))
					.py(px(5.))
					.border_t_1()
					.border_color(p.line_soft)
					.child(
						div()
							.truncate()
							.text_size(px(11.))
							.line_height(px(15.))
							.child(error.path.clone()),
					)
					.child(
						div()
							.truncate()
							.text_size(px(10.))
							.line_height(px(14.))
							.text_color(p.muted)
							.child(match &error.code {
								Some(code) => format!("{code} · {}", error.message),
								None => error.message.clone(),
							}),
					)
			});
			div()
				.mt(px(10.))
				.rounded(px(6.))
				.border_1()
				.border_color(p.line)
				.overflow_hidden()
				.child(
					div()
						.flex()
						.justify_between()
						.px(px(10.))
						.py(px(5.))
						.bg(p.fill)
						.text_size(px(11.))
						.font_weight(FontWeight::SEMIBOLD)
						.child(label)
						.child(
							div()
								.text_color(p.muted)
								.child(grouped(errors.len() as u64)),
						),
				)
				.child(
					div()
						.id(("issue-list", id))
						.max_h(px(180.))
						.overflow_y_scroll()
						.children(rows)
						.when(errors.len() > LISTED_MAX, |this| {
							this.child(
								div()
									.px(px(10.))
									.py(px(5.))
									.border_t_1()
									.border_color(p.line_soft)
									.text_size(px(11.))
									.text_color(p.muted)
									.child(format!(
										"… {} more not shown",
										grouped((errors.len() - LISTED_MAX) as u64)
									)),
							)
						}),
				)
		};
		// One of the issues with a fix: what it is, why, and the buttons.
		let fixable = |title: String, text: String, buttons: Vec<AnyElement>| {
			div()
				.mt(px(12.))
				.p(px(12.))
				.rounded(px(8.))
				.border_1()
				.border_color(p.line)
				.child(
					div()
						.flex()
						.gap(px(10.))
						.child(icon("shield", 16., p.muted))
						.child(
							div()
								.flex_1()
								.min_w_0()
								.child(div().font_weight(FontWeight::SEMIBOLD).child(title))
								.child(
									div()
										.mt(px(2.))
										.text_size(px(12.))
										.text_color(p.muted)
										.child(text),
								)
								.child(div().mt(px(10.)).flex().gap(px(8.)).children(buttons)),
						),
				)
		};
		let it = |count: usize| if count == 1 { "it" } else { "them" };

		let mut body = div()
			.id("issues-body")
			.flex_1()
			.min_h_0()
			.overflow_y_scroll();
		let has_fix = !issues.protected.is_empty() || !issues.admin.is_empty();

		if !issues.protected.is_empty() {
			let count = issues.protected.len();
			let shown = modal.show_protected;
			body = body.child(fixable(
				format!(
					"{} protected by macOS",
					many(count, "folder is", "folders are")
				),
				format!(
					"macOS keeps apps out of Mail, Messages, Safari, and other apps' data unless \
					 you give them Full Disk Access. To include {}, turn Observatory on in the \
					 list, reopen it when macOS asks, and scan again.",
					it(count)
				),
				vec![
					button(
						"issues-settings",
						"Open System Settings",
						ButtonKind::Primary,
						true,
						&p,
					)
					.on_click(|_, _, cx| cx.open_url(FULL_DISK_ACCESS_SETTINGS))
					.into_any_element(),
					button(
						"issues-protected-toggle",
						if shown {
							"Hide folders"
						} else {
							"Show folders"
						},
						ButtonKind::Default,
						true,
						&p,
					)
					.on_click(cx.listener(|this, _, _, cx| {
						if let Some(modal) = this.issues_mut() {
							modal.show_protected = !modal.show_protected;
						}
						cx.notify();
					}))
					.into_any_element(),
				],
			));
			if shown {
				body = body.child(list("Protected by macOS".into(), &issues.protected, 100));
			}
		}

		if !issues.admin.is_empty() {
			let count = issues.admin.len();
			let shown = modal.show_admin;
			let path = root.to_string();
			body = body.child(fixable(
				format!(
					"{} an administrator",
					many(count, "folder needs", "folders need")
				),
				format!(
					"Windows keeps apps out of system folders, other accounts' files, and some \
					 apps' data unless they run as an administrator. To include {}, restart \
					 Observatory as one, and it'll scan again once Windows has asked you.",
					it(count)
				),
				vec![
					button(
						"issues-admin",
						"Restart as administrator",
						ButtonKind::Primary,
						true,
						&p,
					)
					.on_click(cx.listener(move |this, _, _, cx| this.restart_as_admin(&path, cx)))
					.into_any_element(),
					button(
						"issues-admin-toggle",
						if shown {
							"Hide folders"
						} else {
							"Show folders"
						},
						ButtonKind::Default,
						true,
						&p,
					)
					.on_click(cx.listener(|this, _, _, cx| {
						if let Some(modal) = this.issues_mut() {
							modal.show_admin = !modal.show_admin;
						}
						cx.notify();
					}))
					.into_any_element(),
				],
			));
			if let Some(failure) = &modal.failure {
				body = body.child(
					div()
						.mt(px(6.))
						.text_size(px(12.))
						.text_color(p.danger_fg)
						.child(failure.clone()),
				);
			}
			if shown {
				body = body.child(list("Needs an administrator".into(), &issues.admin, 101));
			}
		}

		for (index, (label, errors)) in issues.listed.iter().enumerate() {
			body = body.child(list(label.to_string(), errors, index));
		}

		let close = |this: &mut Self, cx: &mut Context<Self>| {
			if let Some((_, inspect)) = this.screen.inspecting_mut() {
				inspect.issues = None;
			}
			cx.notify();
		};
		let card = modal_card(560., &p)
			.flex()
			.flex_col()
			.max_h(px(620.))
			.child(
				div()
					.flex()
					.flex_none()
					.items_start()
					.justify_between()
					.child(
						div()
							.child(
								div()
									.text_size(px(16.))
									.font_weight(FontWeight::SEMIBOLD)
									.child("Scan issues"),
							)
							.child(div().text_color(p.muted).child(format!(
								"{} skipped or unreadable",
								many(errors.len(), "entry", "entries")
							))),
					)
					.child(
						icon_button("issues-x", "x", true, &p)
							.on_click(cx.listener(move |this, _, _, cx| close(this, cx))),
					),
			)
			.child(body)
			.child(
				div().mt(px(16.)).flex().flex_none().justify_end().child(
					button(
						"issues-close",
						"Close",
						// With a fix on offer, that's the thing to press.
						if has_fix {
							ButtonKind::Default
						} else {
							ButtonKind::Primary
						},
						false,
						&p,
					)
					.on_click(cx.listener(move |this, _, _, cx| close(this, cx))),
				),
			);
		Some(
			self.frame
				.round(scrim(&p), &ALL_CORNERS)
				.on_mouse_down(
					MouseButton::Left,
					cx.listener(move |this, _, _, cx| close(this, cx)),
				)
				.child(card)
				.into_any_element(),
		)
	}
}
