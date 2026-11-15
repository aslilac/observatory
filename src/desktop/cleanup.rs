// Cleanup: the queue of things the user means to get rid of. The chip in
// the toolbar opens the panel, a drawer over whatever screen is showing, so
// they can keep browsing while they fill it; the modal asks before anything
// goes.

use crate::chrome::TOOLBAR_HEIGHT;
use crate::controls::{ButtonKind, button, chip, icon, icon_button, modal_card, scrim};
use crate::palette::Palette;
use crate::popup::queued_menu;
use crate::workspace::Workspace;
use gpui::{
	Animation, AnimationExt, AnyElement, Context, Div, FontWeight, MouseButton, MouseDownEvent,
	Stateful, Window, div, prelude::*, px,
};
use observatory_core::cleanup::{DeleteMode, DeleteResult, delete_files};
use observatory_core::format::{plural, readable_size};
use observatory_core::paths::basename;
use observatory_core::tree::Item;
use std::time::Duration;

const PANEL_WIDTH: f32 = 300.;

/// What a drag out of a list or the sunburst carries.
#[derive(Clone)]
pub struct DraggedItems(pub Vec<Item>);

// What follows the pointer while they're dragged.
struct DragPreview {
	label: String,
	palette: Palette,
}

impl Render for DragPreview {
	fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		let p = self.palette;
		div()
			.px(px(10.))
			.py(px(5.))
			.rounded(px(6.))
			.bg(p.default)
			.text_color(p.background)
			.text_size(px(12.))
			.font(crate::fonts::inter())
			.font_weight(FontWeight::MEDIUM)
			.shadow_md()
			.child(self.label.clone())
	}
}

/// Makes `element` something to drag to cleanup, taking `items` with it.
pub fn draggable(element: Stateful<Div>, items: Vec<Item>, p: Palette) -> Stateful<Div> {
	let label = match items.as_slice() {
		[item] => item.name.clone(),
		items => plural(items.len() as u64, "item"),
	};
	element.on_drag(DraggedItems(items), move |_, _, _, cx| {
		cx.new(|_| DragPreview {
			label: label.clone(),
			palette: p,
		})
	})
}

/// Where the modal is, from asking to having done it.
pub enum CleanupModal {
	Confirm,
	Deleting(DeleteMode),
	Done {
		mode: DeleteMode,
		result: DeleteResult,
		// How much what's gone took up.
		size: u64,
	},
}

impl CleanupModal {
	/// Whether it's in the middle of deleting, and can't be shut.
	pub fn busy(&self) -> bool {
		matches!(self, Self::Deleting(_))
	}
}

impl Workspace {
	pub fn render_cleanup_chip(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let count = self.store.cleanup().len();
		let meter = p.meter;
		chip("cleanup-chip", &p)
			.when(self.cleanup_open, |this| this.bg(p.fill))
			.child(icon("trash", 13., p.muted))
			.child("Cleanup")
			.when(count > 0, |this| {
				this.child(
					div()
						.text_color(p.muted)
						.child(readable_size(self.store.cleanup_size())),
				)
			})
			// Dropping on the chip is as good as on the panel.
			.drag_over::<DraggedItems>(move |style, _, _, _| {
				style.border_dashed().border_color(meter)
			})
			.on_drop(cx.listener(|this, dragged: &DraggedItems, _, cx| {
				this.move_to_cleanup(dragged.0.clone(), cx)
			}))
			.on_click(cx.listener(|this, _, _, cx| {
				this.cleanup_open = !this.cleanup_open;
				cx.notify();
			}))
			.into_any_element()
	}

	pub fn render_cleanup_panel(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		if !self.cleanup_open {
			return None;
		}
		let p = self.palette;
		let meter = p.meter;
		// Largest first: what's worth the most to be rid of.
		let mut queued: Vec<&Item> = self.store.cleanup().iter().map(|it| &it.item).collect();
		queued.sort_by_key(|item| std::cmp::Reverse(item.size));

		let rows = queued.iter().enumerate().map(|(index, item)| {
			let (path, menu_path) = (item.path.clone(), item.path.clone());
			div()
				.id(("queued", index))
				.flex()
				.items_center()
				.gap(px(8.))
				.px(px(8.))
				.py(px(6.))
				.rounded(px(5.))
				.hover(move |style| style.bg(p.fill))
				.child(icon(
					if item.directory { "folder" } else { "file" },
					13.,
					p.faint,
				))
				.child(div().flex_1().min_w_0().truncate().child(item.name.clone()))
				.child(
					div()
						.flex_none()
						.text_size(px(12.))
						.text_color(p.muted)
						.child(readable_size(item.size)),
				)
				.child(
					icon_button(("unqueue", index), "x", true, &p)
						.size(px(20.))
						.on_click(cx.listener(move |this, _, _, cx| {
							this.store.remove_from_cleanup(&path);
							cx.notify();
						})),
				)
				.on_mouse_down(
					MouseButton::Right,
					cx.listener(move |this, event: &MouseDownEvent, _, cx| {
						this.show_popup(event.position, queued_menu(&menu_path), cx)
					}),
				)
		});

		let body = if queued.is_empty() {
			div()
				.flex_1()
				.flex()
				.flex_col()
				.items_center()
				.justify_center()
				.gap(px(6.))
				.p(px(24.))
				.child(icon("trash", 22., p.faint))
				.child(
					div()
						.font_weight(FontWeight::MEDIUM)
						.child("Nothing to clean up"),
				)
				.child(
					div()
						.text_center()
						.text_size(px(12.))
						.text_color(p.muted)
						.child(if cx.has_active_drag() {
							"Drop it here to move it to cleanup."
						} else {
							"Drag files and folders here, or right-click one and choose \
							 Move to cleanup."
						}),
				)
				.into_any_element()
		} else {
			div()
				.id("cleanup-items")
				.flex_1()
				.min_h_0()
				.overflow_y_scroll()
				.p(px(8.))
				.children(rows)
				.into_any_element()
		};

		let panel = div()
			.id("cleanup-panel")
			.absolute()
			.top(px(TOOLBAR_HEIGHT))
			.bottom_0()
			.right_0()
			.w(px(PANEL_WIDTH))
			.flex()
			.flex_col()
			.occlude()
			.bg(p.background)
			.border_l_1()
			.border_color(p.line)
			.shadow_lg()
			.drag_over::<DraggedItems>(move |style, _, _, _| style.border_color(meter))
			.on_drop(cx.listener(|this, dragged: &DraggedItems, _, cx| {
				this.move_to_cleanup(dragged.0.clone(), cx)
			}))
			.child(
				div()
					.flex()
					.flex_none()
					.items_center()
					.justify_between()
					.h(px(40.))
					.pl(px(16.))
					.pr(px(8.))
					.border_b_1()
					.border_color(p.line_soft)
					.child(div().font_weight(FontWeight::SEMIBOLD).child("Cleanup"))
					.child(
						icon_button("cleanup-close", "x", true, &p).on_click(cx.listener(
							|this, _, _, cx| {
								this.cleanup_open = false;
								cx.notify();
							},
						)),
					),
			)
			.child(body)
			.when(!queued.is_empty(), |this| {
				this.child(
					div()
						.flex()
						.flex_none()
						.items_center()
						.gap(px(8.))
						.p(px(12.))
						.border_t_1()
						.border_color(p.line_soft)
						.child(
							div()
								.flex_1()
								.flex()
								.flex_col()
								.child(
									div()
										.font_weight(FontWeight::SEMIBOLD)
										.child(readable_size(self.store.cleanup_size())),
								)
								.child(
									div()
										.text_size(px(11.))
										.text_color(p.muted)
										.child(plural(queued.len() as u64, "item")),
								),
						)
						.child(
							button("cleanup-clear", "Clear", ButtonKind::Default, true, &p)
								.on_click(cx.listener(|this, _, _, cx| {
									this.store.clear_cleanup();
									cx.notify();
								})),
						)
						.child(
							button("cleanup-delete", "Delete…", ButtonKind::Danger, true, &p)
								.on_click(cx.listener(|this, _, _, cx| {
									this.cleanup_modal = Some(CleanupModal::Confirm);
									cx.notify();
								})),
						),
				)
			});
		// It slides out from the window's edge.
		Some(
			panel
				.with_animation(
					"cleanup-slide",
					Animation::new(Duration::from_millis(180)).with_easing(gpui::ease_out_quint()),
					|panel, t| panel.right(px(-PANEL_WIDTH * (1. - t))),
				)
				.into_any_element(),
		)
	}

	fn delete_queued(&mut self, mode: DeleteMode, window: &mut Window, cx: &mut Context<Self>) {
		let queued: Vec<(String, u64)> = self
			.store
			.cleanup()
			.iter()
			.map(|queued| (queued.item.path.clone(), queued.item.size))
			.collect();
		if queued.is_empty() {
			return;
		}
		self.cleanup_modal = Some(CleanupModal::Deleting(mode));
		cx.notify();
		let scans = self.scans.clone();
		cx.spawn_in(window, async move |this, cx| {
			let paths: Vec<String> = queued.iter().map(|(path, _)| path.clone()).collect();
			let result = cx
				.background_executor()
				.spawn(async move { delete_files(&scans, &paths, mode) })
				.await;
			this.update_in(cx, |this, window, cx| {
				let size = queued
					.iter()
					.filter(|(path, _)| result.deleted.contains(path))
					.map(|(_, size)| size)
					.sum();
				for path in &result.deleted {
					this.store.remove_from_cleanup(path);
				}
				this.selection
					.retain(|item| !result.deleted.contains(&item.path));
				this.cleanup_modal = Some(CleanupModal::Done { mode, result, size });
				// What's gone is out of the scans' trees too.
				this.sync(window, cx);
			})
			.ok();
		})
		.detach();
	}

	pub fn render_cleanup_modal(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		let p = self.palette;
		let modal = self.cleanup_modal.as_ref()?;
		let title = |text: String| {
			div()
				.text_size(px(16.))
				.font_weight(FontWeight::SEMIBOLD)
				.child(text)
		};
		let close = |this: &mut Self, cx: &mut Context<Self>| {
			this.cleanup_modal = None;
			cx.notify();
		};
		let card = match modal {
			CleanupModal::Confirm => {
				let queued = self.store.cleanup();
				let rows = queued.iter().map(|queued| {
					div()
						.flex()
						.items_center()
						.gap(px(8.))
						.py(px(4.))
						.child(icon(
							if queued.item.directory {
								"folder"
							} else {
								"file"
							},
							13.,
							p.faint,
						))
						.child(
							div()
								.flex_1()
								.min_w_0()
								.truncate()
								.child(queued.item.name.clone()),
						)
						.child(
							div()
								.flex_none()
								.text_size(px(12.))
								.text_color(p.muted)
								.child(readable_size(queued.item.size)),
						)
				});
				modal_card(460., &p)
					.child(title(format!(
						"Delete {}?",
						plural(queued.len() as u64, "item")
					)))
					.child(div().mt(px(4.)).text_color(p.muted).child(format!(
						"{} in all. Deleting frees the space right away and can't be undone; \
						 the Trash keeps it until it's emptied.",
						readable_size(self.store.cleanup_size())
					)))
					.child(
						div()
							.id("cleanup-confirm-items")
							.mt(px(14.))
							.max_h(px(240.))
							.overflow_y_scroll()
							.px(px(10.))
							.py(px(4.))
							.rounded(px(6.))
							.bg(p.fill)
							.children(rows),
					)
					.child(
						div()
							.mt(px(20.))
							.flex()
							.justify_end()
							.gap(px(8.))
							.child(
								button("cleanup-cancel", "Cancel", ButtonKind::Default, false, &p)
									.on_click(cx.listener(move |this, _, _, cx| close(this, cx))),
							)
							.child(
								button(
									"cleanup-trash",
									"Move to Trash",
									ButtonKind::Default,
									false,
									&p,
								)
								.on_click(cx.listener(|this, _, window, cx| {
									this.delete_queued(DeleteMode::Trash, window, cx)
								})),
							)
							.child(
								button("cleanup-confirm", "Delete", ButtonKind::Danger, false, &p)
									.on_click(cx.listener(|this, _, window, cx| {
										this.delete_queued(DeleteMode::Delete, window, cx)
									})),
							),
					)
			}
			CleanupModal::Deleting(mode) => modal_card(360., &p).child(
				div()
					.flex()
					.items_center()
					.gap(px(10.))
					.child(icon("loader-circle", 16., p.muted))
					.child(title(
						match mode {
							DeleteMode::Trash => "Moving to the Trash…",
							DeleteMode::Delete => "Deleting…",
						}
						.to_string(),
					)),
			),
			CleanupModal::Done { mode, result, size } => {
				let count = result.deleted.len() as u64;
				let heading = match (count, mode) {
					(0, _) => "Nothing was deleted".to_string(),
					(_, DeleteMode::Trash) => {
						format!("Moved {} to the Trash", plural(count, "item"))
					}
					(_, DeleteMode::Delete) => format!("Deleted {}", plural(count, "item")),
				};
				let freed = match mode {
					_ if count == 0 => None,
					DeleteMode::Trash => {
						Some(format!("Empty the Trash to free {}", readable_size(*size)))
					}
					DeleteMode::Delete => Some(format!("That freed {}", readable_size(*size))),
				};
				let failures = result.failed.iter().map(|(path, why)| {
					div()
						.py(px(4.))
						.child(
							div()
								.truncate()
								.text_size(px(12.))
								.child(basename(path).to_string()),
						)
						.child(
							div()
								.text_size(px(11.))
								.text_color(p.danger_fg)
								.child(why.clone()),
						)
				});
				modal_card(420., &p)
					.child(title(heading))
					.children(freed.map(|freed| div().mt(px(4.)).text_color(p.muted).child(freed)))
					.when(!result.failed.is_empty(), |this| {
						this.child(
							div()
								.mt(px(14.))
								.text_size(px(12.))
								.text_color(p.muted)
								.child(format!(
									"{} couldn't be deleted:",
									plural(result.failed.len() as u64, "item")
								)),
						)
						.child(
							div()
								.id("cleanup-failures")
								.mt(px(6.))
								.max_h(px(200.))
								.overflow_y_scroll()
								.px(px(10.))
								.py(px(4.))
								.rounded(px(6.))
								.border_1()
								.border_color(p.danger_border)
								.bg(p.danger_bg)
								.children(failures),
						)
					})
					.child(
						div().mt(px(20.)).flex().justify_end().child(
							button("cleanup-done", "Done", ButtonKind::Primary, false, &p)
								.on_click(cx.listener(move |this, _, _, cx| close(this, cx))),
						),
					)
			}
		};
		let busy = modal.busy();
		Some(
			scrim(&p)
				.on_mouse_down(
					MouseButton::Left,
					cx.listener(move |this, _, _, cx| {
						if !busy {
							close(this, cx);
						}
					}),
				)
				.child(card)
				.into_any_element(),
		)
	}
}
