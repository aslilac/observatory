// Cleanup: the queue of things the user means to get rid of. The chip in
// the toolbar opens the panel, a drawer over whatever screen is showing, so
// they can keep browsing while they fill it; the modal asks before anything
// goes.

use crate::chrome::TOOLBAR_HEIGHT;
use crate::controls::{ButtonKind, button, chip, icon, icon_button, modal_card, scrim};
use crate::palette::Palette;
use crate::popup::queued_menu;
use crate::window_frame::ALL_CORNERS;
use crate::workspace::Workspace;
use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{
	Animation, AnimationExt, AnyElement, Context, Corner, Div, FontWeight, MouseButton,
	MouseDownEvent, Pixels, Point, Stateful, Transformation, Window, div, percentage, prelude::*,
	px, relative,
};
use observatory_core::cleanup::{DeleteMode, Step, delete_files};
use observatory_core::format::{plural, readable_size};
use observatory_core::paths::basename;
use observatory_core::tree::Item;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const PANEL_WIDTH: f32 = 300.;

/// What a drag out of a list or the sunburst carries.
#[derive(Clone)]
pub struct DraggedItems(pub Vec<Item>);

// What follows the pointer while they're dragged.
struct DragPreview {
	label: String,
	palette: Palette,
	// Where in what's dragged the pointer took hold of it. gpui keeps the
	// preview that far up and left of the pointer, as if it were the thing
	// itself; the label is a small stand-in, so it's set back in by as much
	// to stay at the pointer, wherever in a row or the sunburst that was.
	held: Point<Pixels>,
}

impl Render for DragPreview {
	fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		let p = self.palette;
		div()
			.pl(self.held.x + px(12.))
			.pt(self.held.y + px(8.))
			.child(
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
					.child(self.label.clone()),
			)
	}
}

/// Makes `element` something to drag to cleanup, taking `items` with it.
pub fn draggable(element: Stateful<Div>, items: Vec<Item>, p: Palette) -> Stateful<Div> {
	let label = match items.as_slice() {
		[item] => item.name.clone(),
		items => plural(items.len() as u64, "item"),
	};
	element.on_drag(DraggedItems(items), move |_, held, _, cx| {
		cx.new(|_| DragPreview {
			label: label.clone(),
			palette: p,
			held,
		})
	})
}

/// One go at deleting what's queued, from the confirmation until its
/// notification is dismissed. Nothing waits on it: the notification sits in
/// the window's corner while the user carries on.
pub struct Deletion {
	// When it began, which is also which one it is, to a timer that outlives
	// it.
	started: Instant,
	mode: DeleteMode,
	// How many it set out to delete, and how it's gone so far.
	total: usize,
	deleted: usize,
	// How much what's gone took up.
	freed: u64,
	// The paths that are still there, each with why.
	failed: Vec<(String, String)>,
	// The one being deleted now.
	current: Option<String>,
	// Set to have it start no more.
	stop: Arc<AtomicBool>,
	running: bool,
	// Whether what failed is listed.
	details: bool,
	// The pointer's over the notification, which keeps it from going away.
	hovered: bool,
}

impl Deletion {
	fn stopping(&self) -> bool {
		self.stop.load(Ordering::Relaxed)
	}
}

// How long the notification of a deletion that went well stays.
const NOTICE: Duration = Duration::from_secs(6);
const NOTICE_WIDTH: f32 = 320.;

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
			// It goes down to the window's corner.
			.map(|this| self.frame.round(this, &[Corner::BottomRight]))
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
							// One deletion at a time.
							button("cleanup-delete", "Delete…", ButtonKind::Danger, true, &p)
								.when(self.deleting(), |this| this.opacity(0.5).cursor_default())
								.on_click(cx.listener(|this, _, _, cx| {
									if !this.deleting() {
										this.cleanup_confirming = true;
										cx.notify();
									}
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

	/// Whether a deletion is under way.
	pub fn deleting(&self) -> bool {
		self.deletion.as_ref().is_some_and(|run| run.running)
	}

	// What the confirmation's buttons do: everything queued goes.
	fn delete_queued(&mut self, mode: DeleteMode, window: &mut Window, cx: &mut Context<Self>) {
		self.cleanup_confirming = false;
		let queued = self
			.store
			.cleanup()
			.iter()
			.map(|queued| (queued.item.path.clone(), queued.item.size))
			.collect();
		self.delete_paths(queued, mode, window, cx);
	}

	// Another go at what the last deletion couldn't delete, if it's still
	// queued.
	fn delete_failed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some(run) = &self.deletion else {
			return;
		};
		let mode = run.mode;
		let queued = self
			.store
			.cleanup()
			.iter()
			.filter(|queued| run.failed.iter().any(|(path, _)| *path == queued.item.path))
			.map(|queued| (queued.item.path.clone(), queued.item.size))
			.collect();
		self.delete_paths(queued, mode, window, cx);
	}

	// Deletes `queued` (paths, with their sizes) on another thread, keeping
	// `self.deletion` up with how it's going.
	fn delete_paths(
		&mut self,
		queued: Vec<(String, u64)>,
		mode: DeleteMode,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		if queued.is_empty() || self.deleting() {
			cx.notify();
			return;
		}
		let started = Instant::now();
		let stop = Arc::new(AtomicBool::new(false));
		self.deletion = Some(Deletion {
			started,
			mode,
			total: queued.len(),
			deleted: 0,
			freed: 0,
			failed: Vec::new(),
			current: None,
			stop: stop.clone(),
			running: true,
			details: false,
			hovered: false,
		});
		cx.notify();
		let scans = self.scans.clone();
		let paths: Vec<String> = queued.iter().map(|(path, _)| path.clone()).collect();
		let (steps, mut told) = mpsc::unbounded();
		cx.spawn_in(window, async move |this, cx| {
			let work = cx.background_executor().spawn(async move {
				delete_files(&scans, &paths, mode, &stop, |step| {
					let _ = steps.unbounded_send(step);
				})
			});
			// It ends when the deleting does, which drops `steps`.
			while let Some(step) = told.next().await {
				let updated = this.update_in(cx, |this, window, cx| {
					let Some(run) = &mut this.deletion else {
						return;
					};
					match step {
						Step::Starting(path) => run.current = Some(path),
						Step::Deleted(path) => {
							run.deleted += 1;
							run.freed += queued
								.iter()
								.find(|(queued, _)| *queued == path)
								.map_or(0, |(_, size)| *size);
							this.store.remove_from_cleanup(&path);
							this.selection.retain(|item| item.path != path);
							// It's out of the scans' trees too.
							this.sync(window, cx);
						}
						Step::Failed(path, why) => run.failed.push((path, why)),
					}
					cx.notify();
				});
				if updated.is_err() {
					return;
				}
			}
			work.await;
			let stays = this
				.update(cx, |this, cx| {
					cx.notify();
					let Some(run) = &mut this.deletion else {
						return true;
					};
					run.running = false;
					run.current = None;
					// What failed is for the user to see, and stays until
					// they've dismissed it.
					!run.failed.is_empty()
				})
				.unwrap_or(true);
			if stays {
				return;
			}
			// Otherwise it goes away by itself, once the pointer's off it.
			let mut wait = NOTICE;
			loop {
				cx.background_executor().timer(wait).await;
				let gone = this.update(cx, |this, cx| {
					match &this.deletion {
						Some(run) if run.started == started && run.hovered => return false,
						Some(run) if run.started == started => {
							this.deletion = None;
							cx.notify();
						}
						// Dismissed already, or another one's begun.
						_ => {}
					}
					true
				});
				if gone.unwrap_or(true) {
					return;
				}
				wait = Duration::from_secs(1);
			}
		})
		.detach();
	}

	/// How the deleting is going, or how it went, in the window's corner.
	pub fn render_deletion(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		let p = self.palette;
		let run = self.deletion.as_ref()?;
		let trash = run.mode == DeleteMode::Trash;
		let (total, deleted) = (run.total as u64, run.deleted as u64);
		let dealt_with = run.deleted + run.failed.len();
		let left = run.total - dealt_with;

		let title = match (run.running, trash) {
			(true, _) if run.stopping() => "Stopping…".to_string(),
			(true, false) => format!("Deleting {}…", plural(total, "item")),
			(true, true) => format!("Moving {} to the Trash…", plural(total, "item")),
			(false, _) if deleted == 0 => "Nothing was deleted".to_string(),
			(false, _) => {
				let count = if deleted == total {
					plural(total, "item")
				} else {
					format!("{deleted} of {}", plural(total, "item"))
				};
				if trash {
					format!("Moved {count} to the Trash")
				} else {
					format!("Deleted {count}")
				}
			}
		};
		let lead = if run.running {
			icon("loader-circle", 18., p.muted)
				.with_animation(
					"deletion-spinner",
					Animation::new(Duration::from_secs(1)).repeat(),
					|icon, t| icon.with_transformation(Transformation::rotate(percentage(t))),
				)
				.into_any_element()
		} else {
			// A tick when it all went, and a mark when some didn't.
			div()
				.flex()
				.items_center()
				.justify_center()
				.size(px(18.))
				.rounded_full()
				.bg(p.default)
				.text_color(p.background)
				.text_size(px(11.))
				.font_weight(FontWeight::SEMIBOLD)
				.map(|this| {
					if run.failed.is_empty() && left == 0 {
						this.child(icon("check", 11., p.background))
					} else {
						this.child("!")
					}
				})
				.into_any_element()
		};
		let action = if !run.running {
			Some(
				icon_button("deletion-dismiss", "x", true, &p)
					.size(px(20.))
					.on_click(cx.listener(|this, _, _, cx| {
						this.deletion = None;
						cx.notify();
					})),
			)
		} else if !run.stopping() && left > 1 {
			// Stopping is between one and the next, so there's nothing to
			// stop on the last.
			Some(
				button("deletion-stop", "Stop", ButtonKind::Default, true, &p)
					.h(px(22.))
					.on_click(cx.listener(|this, _, _, cx| {
						if let Some(run) = &this.deletion {
							run.stop.store(true, Ordering::Relaxed);
						}
						cx.notify();
					})),
			)
		} else {
			None
		};
		let line = || div().mt(px(2.)).text_color(p.muted);

		let body = if run.running {
			let so_far = format!("{dealt_with} of {total}");
			div()
				.child(line().child(if trash || run.freed == 0 {
					so_far
				} else {
					format!("{so_far} · {} freed so far", readable_size(run.freed))
				}))
				.child(
					div()
						.mt(px(8.))
						.h(px(4.))
						.rounded(px(2.))
						.bg(p.fill_strong)
						.overflow_hidden()
						.child(
							div()
								.h_full()
								.w(relative(dealt_with as f32 / run.total as f32))
								.bg(p.default),
						),
				)
				.child(
					div()
						.mt(px(6.))
						.h(px(15.))
						.truncate()
						.text_size(px(11.))
						.line_height(px(15.))
						.text_color(p.muted)
						.children(run.current.clone()),
				)
		} else {
			let failures = run.failed.iter().map(|(path, why)| {
				div()
					.py(px(5.))
					.child(div().truncate().child(basename(path).to_string()))
					.child(
						div()
							.text_size(px(11.))
							.line_height(px(15.))
							.text_color(p.danger_fg)
							.child(why.clone()),
					)
			});
			div()
				.when(deleted > 0, |this| {
					this.child(line().child(if trash {
						format!("Empty the Trash to free {}", readable_size(run.freed))
					} else {
						format!("That freed {}", readable_size(run.freed))
					}))
				})
				// Stopped before it got to these.
				.when(left > 0, |this| {
					this.child(line().child(format!(
						"{} still in cleanup",
						match left {
							1 => "1 item is".to_string(),
							left => format!("{left} items are"),
						}
					)))
				})
				.when(!run.failed.is_empty(), |this| {
					this.child(
						div()
							.mt(px(6.))
							.flex()
							.items_center()
							.gap(px(8.))
							.child(div().flex_1().text_color(p.danger_fg).child(format!(
								"{} couldn't be deleted",
								plural(run.failed.len() as u64, "item")
							)))
							.child(
								div()
									.id("deletion-details")
									.flex_none()
									.cursor_pointer()
									.font_weight(FontWeight::MEDIUM)
									.underline()
									.child(if run.details {
										"Hide details"
									} else {
										"Show details"
									})
									.on_click(cx.listener(|this, _, _, cx| {
										if let Some(run) = &mut this.deletion {
											run.details = !run.details;
										}
										cx.notify();
									})),
							),
					)
				})
				.when(run.details && !run.failed.is_empty(), |this| {
					this.child(
						div()
							.id("deletion-failures")
							.mt(px(8.))
							.max_h(px(160.))
							.overflow_y_scroll()
							.px(px(10.))
							.rounded(px(6.))
							.border_1()
							.border_color(p.danger_border)
							.bg(p.danger_bg)
							.children(failures),
					)
					.child(
						div().mt(px(10.)).flex().justify_end().child(
							button("deletion-retry", "Try again", ButtonKind::Default, true, &p)
								.on_click(cx.listener(|this, _, window, cx| {
									this.delete_failed(window, cx)
								})),
						),
					)
				})
		};

		Some(
			div()
				.id("deletion")
				.absolute()
				.bottom(px(14.))
				// Beside the cleanup panel, not over it.
				.right(px(14. + if self.cleanup_open { PANEL_WIDTH } else { 0. }))
				.w(px(NOTICE_WIDTH))
				.occlude()
				.flex()
				.items_start()
				.gap(px(10.))
				.pl(px(14.))
				.pr(px(12.))
				.py(px(12.))
				.rounded(px(10.))
				.bg(p.background)
				.border_1()
				.border_color(p.line)
				.shadow_lg()
				.text_size(px(12.))
				.on_hover(cx.listener(|this, over: &bool, _, _| {
					if let Some(run) = &mut this.deletion {
						run.hovered = *over;
					}
				}))
				.child(div().flex_none().mt(px(1.)).child(lead))
				.child(
					div()
						.flex_1()
						.min_w_0()
						.child(
							div()
								.flex()
								.items_center()
								.gap(px(8.))
								.h(px(20.))
								.child(
									div()
										.flex_1()
										.min_w_0()
										.truncate()
										.text_size(px(13.))
										.font_weight(FontWeight::SEMIBOLD)
										.child(title),
								)
								.children(action),
						)
						.child(body),
				)
				.into_any_element(),
		)
	}

	/// Asks before anything goes, and how it should.
	pub fn render_cleanup_modal(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		let p = self.palette;
		if !self.cleanup_confirming {
			return None;
		}
		let title = |text: String| {
			div()
				.text_size(px(16.))
				.font_weight(FontWeight::SEMIBOLD)
				.child(text)
		};
		let close = |this: &mut Self, cx: &mut Context<Self>| {
			this.cleanup_confirming = false;
			cx.notify();
		};
		let card = {
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
							button(
								"cleanup-confirm",
								"Delete permanently",
								ButtonKind::Danger,
								false,
								&p,
							)
							.on_click(cx.listener(|this, _, window, cx| {
								this.delete_queued(DeleteMode::Delete, window, cx)
							})),
						),
				)
		};
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
