// Cleanup: the queue of things the user means to get rid of. It floats in
// the window's bottom-left corner, over whatever screen is showing, so they
// can keep browsing while they fill it: a pill that opens into a card, which
// is the queue, then the question before anything goes, then the deleting
// and how it went.

use crate::controls::{ButtonKind, button, icon, icon_button, tip};
use crate::palette::{Palette, hsla};
use crate::popup::queued_menu;
use crate::workspace::Workspace;
use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{
	Animation, AnimationExt, AnyElement, Context, Div, DragMoveEvent, FontWeight, Hsla,
	MouseButton, MouseDownEvent, Pixels, Point, Stateful, Transformation, Window, div, percentage,
	prelude::*, px, relative,
};
use observatory_core::cleanup::{DeleteMode, Step, delete_files};
use observatory_core::color::{Color, Kind, sunburst_color};
use observatory_core::drives::{Drive, Usage, drive_of};
use observatory_core::format::{plural, readable_size};
use observatory_core::paths::basename;
use observatory_core::store::Store;
use observatory_core::tree::Item;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

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

/// One go at deleting what's queued, from the question's answer until the
/// card's said how it went. Nothing waits on it: the card (or the pill, with
/// the card shut) follows it while the user carries on.
pub struct Deletion {
	// When it began, which is also which one it is, to a timer that outlives
	// it.
	started: Instant,
	mode: DeleteMode,
	// What it set out to delete: each path and its size.
	items: Vec<(String, u64)>,
	// Those that are gone.
	gone: Vec<String>,
	// How much they took up.
	freed: u64,
	// The paths that are still there, each with why.
	failed: Vec<(String, String)>,
	// The one being deleted now.
	current: Option<String>,
	// Set to have it start no more.
	stop: Arc<AtomicBool>,
	running: bool,
	// The pointer's over the card, which keeps it from going away.
	hovered: bool,
	// The disk it's all on and how full that was beforehand, if it's one
	// disk.
	disk: Option<(String, Usage)>,
}

impl Deletion {
	fn stopping(&self) -> bool {
		self.stop.load(Ordering::Relaxed)
	}

	fn size(&self) -> u64 {
		self.items.iter().map(|(_, size)| size).sum()
	}
}

// How long the card of a deletion that went well stays.
const NOTICE: Duration = Duration::from_secs(6);
const CARD_WIDTH: f32 = 340.;
// How many of what's queued have a segment of their own in the bar, before
// the rest share one.
const SEGMENTS: usize = 24;
// How tall a row of the queue is, and how many show before it scrolls.
const ROW: f32 = 26.;
const ROWS: usize = 12;

// The color something queued has in the card: its dot's, and its segment's in
// the bar. It's the one it had in the sunburst it was queued from. Where
// that isn't known (it was queued by an earlier version), it's one made up
// from its path, so it at least keeps it while the queue changes.
fn queued_color(store: &Store, path: &str, p: &Palette) -> Hsla {
	let queued = store
		.cleanup()
		.iter()
		.find(|queued| queued.item.path == path);
	if let Some(queued) = queued
		&& let Some(tint) = queued.tint
	{
		let kind = if queued.item.directory {
			Kind::Directory
		} else {
			Kind::File
		};
		return hsla(sunburst_color(
			tint.hue as f64,
			tint.depth as usize,
			kind,
			p.dark,
		));
	}
	// FNV-1a, for a hue.
	let hash = path.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
		(hash ^ byte as u64).wrapping_mul(0x100000001b3)
	});
	hsla(sunburst_color(
		(hash % 360) as f64,
		0,
		Kind::Directory,
		p.dark,
	))
}

// What cleanup takes off a disk is drawn in this, between what's used and
// what's free.
fn reclaim_color() -> Hsla {
	hsla(Color::oklch(0.78, 0.16, 30.0))
}

impl Workspace {
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
			items: queued.clone(),
			gone: Vec::new(),
			freed: 0,
			failed: Vec::new(),
			current: None,
			stop: stop.clone(),
			running: true,
			hovered: false,
			disk: self.disk_of(queued.iter().map(|(path, _)| path.as_str())),
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
							run.gone.push(path.clone());
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
					let stays = !run.failed.is_empty();
					if !stays {
						// With the card that says how it went, cleanup's
						// done: what comes after it is the pill, if
						// anything's still queued.
						this.cleanup_open = false;
					}
					stays
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

	// The disk everything in `paths` is on and how full it is, if that's one
	// disk, and one that says.
	fn disk_of<'a>(&self, paths: impl Iterator<Item = &'a str>) -> Option<(String, Usage)> {
		let mut disk: Option<&Drive> = None;
		for path in paths {
			let drive = drive_of(&self.drives, path)?;
			if disk.is_some_and(|disk| disk.mount_path != drive.mount_path) {
				return None;
			}
			disk = Some(drive);
		}
		let disk = disk?;
		Some((disk.title(), disk.usage.clone()?))
	}

	/// Cleanup, floating in the window's bottom-left corner. Shut, it's a
	/// pill, there over a scan's results and while anything's queued (or
	/// being dragged, or deleted).
	/// Open, it's a card that's the queue, then the question before anything
	/// goes, then how the deleting's going, then how it went.
	pub fn render_cleanup(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		let queued = !self.store.cleanup().is_empty();
		let dragging = self.dragging_items && cx.has_active_drag();
		Some(match &self.deletion {
			// How it went is said whether or not the card was open.
			Some(run) if !run.running => self.render_deleted(run, cx),
			Some(run) if self.cleanup_open => self.render_deleting(run, cx),
			Some(_) => self.render_pill(cx),
			None if self.cleanup_confirming && queued => self.render_confirmation(cx),
			None if self.cleanup_open => self.render_queue(cx),
			None if dragging => self.render_landing(cx),
			// With nothing queued it's still there over a scan's results,
			// so it's plain there's somewhere to drag things to.
			None if queued || self.tree.is_some() => self.render_pill(cx),
			None => return None,
		})
	}

	// What the pill opens out into while something's being dragged: somewhere
	// to land it, bigger than the pill and with a quiet dashed edge. With the
	// drag over it, it fills in and says what the queue would come to.
	fn render_landing(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let over = self.drop_over;
		let warm = reclaim_color();
		let queued = self.store.cleanup_size();
		let count = self.store.cleanup().len() as u64;
		let says = match (over, count) {
			(false, 0) => "Nothing queued yet".to_string(),
			(false, _) => format!("{count} queued · {}", readable_size(queued)),
			(true, 0) => format!("+ {}", readable_size(self.dragging_size)),
			(true, _) => format!(
				"{} → {}",
				readable_size(queued),
				readable_size(queued + self.dragging_size)
			),
		};
		div()
			.id("cleanup-landing")
			.absolute()
			.bottom(px(14.))
			.left(px(14.))
			.occlude()
			.flex()
			.items_center()
			.gap(px(12.))
			.w(px(236.))
			.px(px(16.))
			.py(px(14.))
			.rounded(px(14.))
			.border_1()
			.shadow_lg()
			.text_size(px(12.))
			.map(|this| {
				if over {
					let mut tint = warm;
					tint.a = 0.22;
					this.border_color(warm).bg(p.background.blend(tint))
				} else {
					this.border_dashed().border_color(p.muted).bg(p.background)
				}
			})
			// Whether the drag's over it: gpui says where the pointer is and
			// where this is with every move of a drag.
			.on_drag_move(
				cx.listener(|this, event: &DragMoveEvent<DraggedItems>, _, cx| {
					let over = event.bounds.contains(&event.event.position);
					if over != this.drop_over {
						this.drop_over = over;
						cx.notify();
					}
				}),
			)
			.on_drop(cx.listener(|this, dragged: &DraggedItems, _, cx| {
				this.move_to_cleanup(dragged.0.clone(), cx)
			}))
			.child(
				div()
					.flex()
					.flex_none()
					.items_center()
					.justify_center()
					.size(px(34.))
					.rounded_full()
					.bg(if over { warm } else { p.fill })
					.child(icon(
						"trash",
						15.,
						// Dark on the warm disc, whichever theme it is.
						if over {
							hsla(Color::oklch(0.2, 0.0, 0.0))
						} else {
							p.default
						},
					)),
			)
			.child(
				div()
					.flex_1()
					.min_w_0()
					.child(
						div()
							.text_size(px(13.))
							.font_weight(FontWeight::SEMIBOLD)
							.child(if over {
								"Let go to add"
							} else {
								"Drop to clean up"
							}),
					)
					.child(
						div()
							.mt(px(2.))
							.truncate()
							.text_size(px(11.))
							.line_height(px(15.))
							.text_color(p.muted)
							.child(says),
					),
			)
			.into_any_element()
	}

	// The card shut: what opens it, and how a deletion's going meanwhile. It's
	// the landing pad at rest, the same size and in the same place, so a drag
	// changes its edge and its words and nothing jumps.
	fn render_pill(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		// With nothing in it, it's quieter, and says what it's for.
		let empty = self.deletion.is_none() && self.store.cleanup().is_empty();
		let (mark, title, says) = match &self.deletion {
			Some(run) if run.running => (
				spinner("pill-spinner", 15., p.muted),
				match run.mode {
					_ if run.stopping() => "Stopping",
					DeleteMode::Delete => "Reclaiming",
					DeleteMode::Trash => "Moving to the Trash",
				},
				format!(
					"{} of {} · {}",
					run.gone.len() + run.failed.len(),
					run.items.len(),
					readable_size(run.freed)
				),
			),
			_ if empty => (
				icon("trash", 15., p.muted).into_any_element(),
				"Cleanup",
				"Drag things here to delete".to_string(),
			),
			_ => (
				icon("trash", 15., p.default).into_any_element(),
				"Cleanup",
				format!(
					"{} queued · {}",
					self.store.cleanup().len(),
					readable_size(self.store.cleanup_size())
				),
			),
		};
		let muted = p.muted;
		div()
			.id("cleanup-pill")
			.absolute()
			.bottom(px(14.))
			.left(px(14.))
			.occlude()
			.flex()
			.items_center()
			.gap(px(12.))
			.w(px(236.))
			.px(px(16.))
			.py(px(14.))
			.rounded(px(14.))
			.bg(p.background)
			.border_1()
			.border_color(p.line)
			.map(|this| {
				if empty {
					this.border_dashed()
				} else {
					this.shadow_lg()
				}
			})
			.text_size(px(12.))
			.cursor_pointer()
			.hover(move |style| style.border_color(muted))
			// Only seen while deleting, when a drag doesn't bring out the pad.
			.drag_over::<DraggedItems>(|style, _, _, _| style.border_color(reclaim_color()))
			.on_drop(cx.listener(|this, dragged: &DraggedItems, _, cx| {
				this.move_to_cleanup(dragged.0.clone(), cx)
			}))
			.on_click(cx.listener(|this, _, _, cx| {
				this.cleanup_open = true;
				cx.notify();
			}))
			.child(
				div()
					.flex()
					.flex_none()
					.items_center()
					.justify_center()
					.size(px(34.))
					.rounded_full()
					.bg(p.fill)
					.child(mark),
			)
			.child(
				div()
					.flex_1()
					.min_w_0()
					.child(
						div()
							.text_size(px(13.))
							.font_weight(FontWeight::SEMIBOLD)
							.child(title),
					)
					.child(
						div()
							.mt(px(2.))
							.truncate()
							.text_size(px(11.))
							.line_height(px(15.))
							.text_color(p.muted)
							.child(says),
					),
			)
			.child(icon("chevron-right", 14., p.muted))
			.into_any_element()
	}

	// The card: what it's about at the top with its buttons, and the rest
	// under that. Whatever's dropped on it is queued.
	fn card(
		&self,
		title: String,
		// What goes back a step, before the title.
		back: Option<AnyElement>,
		actions: Vec<AnyElement>,
		body: Div,
		cx: &mut Context<Self>,
	) -> AnyElement {
		let p = self.palette;
		let leads = back.is_some();
		div()
			.id("cleanup")
			.absolute()
			.bottom(px(14.))
			.left(px(14.))
			.w(px(CARD_WIDTH))
			.occlude()
			.flex()
			.flex_col()
			.rounded(px(12.))
			.bg(p.background)
			.border_1()
			.border_color(p.line)
			.shadow_lg()
			.text_size(px(12.))
			.drag_over::<DraggedItems>(|style, _, _, _| style.border_color(reclaim_color()))
			.on_drop(cx.listener(|this, dragged: &DraggedItems, _, cx| {
				this.move_to_cleanup(dragged.0.clone(), cx)
			}))
			// A press anywhere else shuts it, and still does whatever it would
			// have: the card isn't in the way of the rest, so a row can be
			// dragged from behind it and land on the pad.
			.on_mouse_down_out(cx.listener(|this, _, _, cx| {
				if this.cleanup_open || this.cleanup_confirming {
					this.cleanup_open = false;
					this.cleanup_confirming = false;
					cx.notify();
				}
			}))
			// The pointer on it keeps the word on how a deletion went from
			// going away.
			.on_hover(cx.listener(|this, over: &bool, _, _| {
				if let Some(run) = &mut this.deletion {
					run.hovered = *over;
				}
			}))
			.child(
				div()
					.flex()
					.items_center()
					.gap(px(4.))
					.h(px(34.))
					.pl(px(if leads { 8. } else { 16. }))
					.pr(px(8.))
					.children(back)
					.child(
						div()
							.flex_1()
							.min_w_0()
							.truncate()
							.text_size(px(10.))
							.font_weight(FontWeight::SEMIBOLD)
							.text_color(p.muted)
							.child(title),
					)
					.children(actions),
			)
			.child(body)
			.into_any_element()
	}

	// The x at the card's top: `does` is what it does there.
	fn card_x(
		&self,
		says: &'static str,
		does: impl Fn(&mut Self) + 'static,
		cx: &mut Context<Self>,
	) -> AnyElement {
		icon_button("cleanup-x", "x", true, &self.palette)
			.size(px(22.))
			.tooltip(tip(says))
			.on_click(cx.listener(move |this, _, _, cx| {
				does(this);
				cx.notify();
			}))
			.into_any_element()
	}

	// The bar down the side of the queue's rows that says there are more than
	// show, and where among them it's scrolled to. Only that: it isn't
	// something to drag. The rows are all one height, so how much there is to
	// scroll is known without waiting to be told.
	fn queue_scrollbar(&self, rows: usize) -> Option<Div> {
		if rows <= ROWS {
			return None;
		}
		let view = ROW * ROWS as f32;
		let beyond = ROW * (rows - ROWS) as f32;
		let scrolled = (-f32::from(self.cleanup_scroll.offset().y) / beyond).clamp(0., 1.);
		let length = (view * view / (view + beyond)).max(24.);
		Some(
			div()
				.absolute()
				.top(px((view - length) * scrolled))
				.right(px(3.))
				.w(px(4.))
				.h(px(length))
				.rounded_full()
				.bg(self.palette.faint),
		)
	}

	// What's queued, largest first: what's worth the most to be rid of.
	fn queued_by_size(&self) -> Vec<(String, u64)> {
		let mut queued: Vec<(String, u64)> = self
			.store
			.cleanup()
			.iter()
			.map(|queued| (queued.item.path.clone(), queued.item.size))
			.collect();
		queued.sort_by_key(|(_, size)| std::cmp::Reverse(*size));
		queued
	}

	// How much is queued, and what share of its disk that is.
	fn queued_total(&self, queued: &[(String, u64)]) -> Div {
		let size: u64 = queued.iter().map(|(_, size)| size).sum();
		let share = self
			.disk_of(queued.iter().map(|(path, _)| path.as_str()))
			.filter(|(_, usage)| usage.total > 0)
			.map(|(name, usage)| {
				format!("{:.1}% of {name}", size as f64 / usage.total as f64 * 100.)
			});
		total(
			readable_size(size),
			[
				plural(queued.len() as u64, "item"),
				share.unwrap_or_default(),
			],
			&self.palette,
		)
	}

	// The card open on the queue.
	fn render_queue(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let shut = self.card_x("Close", |this| this.cleanup_open = false, cx);
		let queued = self.queued_by_size();
		if queued.is_empty() {
			let dragging = self.dragging_items && cx.has_active_drag();
			let body = div().px(px(16.)).pb(px(16.)).child(
				div()
					.px(px(16.))
					.py(px(22.))
					.rounded(px(10.))
					.border_1()
					.border_dashed()
					.border_color(p.line)
					.flex()
					.flex_col()
					.items_center()
					.gap(px(4.))
					.child(
						div()
							.text_size(px(13.))
							.font_weight(FontWeight::SEMIBOLD)
							.child("Nothing to clean up yet"),
					)
					.child(div().text_center().text_color(p.muted).child(if dragging {
						"Drop it here to move it to cleanup."
					} else {
						"Drag files and folders here, or right-click one and choose Move to \
						 cleanup. Nothing is deleted until you say so."
					})),
			);
			return self.card("CLEANUP".into(), None, vec![shut], body, cx);
		}

		let mut rows = Vec::new();
		for (index, (path, size)) in queued.iter().enumerate() {
			let (remove, menu) = (path.clone(), path.clone());
			let fill = p.fill;
			rows.push(
				div()
					.id(("queued", index))
					.flex()
					.items_center()
					.gap(px(8.))
					.pl(px(8.))
					.pr(px(2.))
					.h(px(ROW))
					.rounded(px(5.))
					.hover(move |style| style.bg(fill))
					.child(
						div()
							.flex_none()
							.size(px(8.))
							.rounded(px(2.))
							.bg(queued_color(&self.store, path, &p)),
					)
					.child(
						div()
							.flex_1()
							.min_w_0()
							.truncate()
							.child(basename(path).to_string()),
					)
					.child(
						div()
							.flex_none()
							.text_size(px(11.))
							.text_color(p.muted)
							.child(readable_size(*size)),
					)
					.child(
						icon_button(("unqueue", index), "x", true, &p)
							.size(px(20.))
							.on_click(cx.listener(move |this, _, _, cx| {
								this.store.remove_from_cleanup(&remove);
								cx.notify();
							})),
					)
					.on_mouse_down(
						MouseButton::Right,
						cx.listener(move |this, event: &MouseDownEvent, _, cx| {
							this.show_popup(event.position, queued_menu(&menu), cx)
						}),
					),
			);
		}
		let deleting = self.deleting();
		let body = div()
			.child(self.queued_total(&queued))
			.child(reclaim_bar(&self.store, &queued, None, &p))
			.child(
				div()
					.relative()
					.mt(px(8.))
					.child(
						div()
							.id("cleanup-items")
							.px(px(8.))
							.max_h(px(ROW * ROWS as f32))
							.overflow_y_scroll()
							.track_scroll(&self.cleanup_scroll)
							.children(rows),
					)
					.children(self.queue_scrollbar(queued.len())),
			)
			.child(
				footer(&p)
					.child(
						button("cleanup-clear", "Clear", ButtonKind::Default, true, &p).on_click(
							cx.listener(|this, _, _, cx| {
								this.store.clear_cleanup();
								cx.notify();
							}),
						),
					)
					.child(
						// One deletion at a time.
						button("cleanup-delete", "Delete…", ButtonKind::Primary, true, &p)
							.when(deleting, |this| this.opacity(0.5).cursor_default())
							.on_click(cx.listener(|this, _, _, cx| {
								if !this.deleting() {
									this.cleanup_confirming = true;
									cx.notify();
								}
							})),
					),
			);
		self.card("YOU'LL RECLAIM".into(), None, vec![shut], body, cx)
	}

	// The card asking before anything goes, and how it should: what there
	// is, and what the disk would look like without it.
	fn render_confirmation(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let queued = self.queued_by_size();
		let size: u64 = queued.iter().map(|(_, size)| size).sum();
		let back = icon_button("cleanup-back", "arrow-left", true, &p)
			.size(px(22.))
			.tooltip(tip("Back to the queue"))
			.on_click(cx.listener(|this, _, _, cx| {
				this.cleanup_confirming = false;
				cx.notify();
			}))
			.into_any_element();
		let disk = self.disk_of(queued.iter().map(|(path, _)| path.as_str()));
		let body = div()
			.child(self.queued_total(&queued))
			.child(reclaim_bar(&self.store, &queued, None, &p))
			.children(disk.map(|(_, usage)| disk_bar(&usage, size, true, &p)))
			.child(div().px(px(16.)).pt(px(10.)).text_color(p.muted).child(
				"Deleting permanently frees the space right away and can't be undone. The \
				 Trash keeps it until it's emptied.",
			))
			.child(
				footer(&p)
					.child(
						button(
							"cleanup-trash",
							"Move to Trash",
							ButtonKind::Default,
							true,
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
							true,
							&p,
						)
						.on_click(cx.listener(|this, _, window, cx| {
							this.delete_queued(DeleteMode::Delete, window, cx)
						})),
					),
			);
		let title = format!(
			"DELETE {}?",
			plural(queued.len() as u64, "item").to_uppercase()
		);
		self.card(title, Some(back), Vec::new(), body, cx)
	}

	// The card while things are deleted: the total counts up, and the bar
	// fills in an item at a time.
	fn render_deleting(&self, run: &Deletion, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let dealt_with = run.gone.len() + run.failed.len();
		let left = run.items.len() - dealt_with;
		let mut actions = Vec::new();
		// Stopping is between one and the next, so there's nothing to stop
		// on the last.
		if !run.stopping() && left > 1 {
			actions.push(
				button("cleanup-stop", "Stop", ButtonKind::Default, true, &p)
					.h(px(22.))
					.mr(px(4.))
					.on_click(cx.listener(|this, _, _, cx| {
						if let Some(run) = &this.deletion {
							run.stop.store(true, Ordering::Relaxed);
						}
						cx.notify();
					}))
					.into_any_element(),
			);
		}
		actions.push(self.card_x("Close", |this| this.cleanup_open = false, cx));
		let body = div()
			.child(total(
				readable_size(run.freed),
				[
					format!("of {}", readable_size(run.size())),
					format!("{dealt_with} of {}", plural(run.items.len() as u64, "item")),
				],
				&p,
			))
			.child(reclaim_bar(&self.store, &run.items, Some(&run.gone), &p))
			.child(
				div()
					.flex()
					.items_center()
					.gap(px(8.))
					.px(px(16.))
					.pt(px(10.))
					.pb(px(14.))
					.child(spinner("cleanup-spinner", 14., p.muted))
					.child(
						div()
							.flex_1()
							.min_w_0()
							.h(px(15.))
							.truncate()
							.text_size(px(11.))
							.line_height(px(15.))
							.text_color(p.muted)
							.children(run.current.clone()),
					),
			);
		let title = match run.mode {
			_ if run.stopping() => "STOPPING",
			DeleteMode::Delete => "RECLAIMING",
			DeleteMode::Trash => "MOVING TO THE TRASH",
		};
		self.card(title.into(), None, actions, body, cx)
	}

	// The card once the deleting's done: what was reclaimed and what the
	// disk has now, or else what's still there and why.
	fn render_deleted(&self, run: &Deletion, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let trash = run.mode == DeleteMode::Trash;
		let (count, deleted) = (run.items.len(), run.gone.len());
		// Not deleted: what failed, and what it was stopped before.
		let left = count - deleted;
		let dismiss = self.card_x("Dismiss", |this| this.deletion = None, cx);
		let title = match (deleted, trash) {
			(0, _) => "NOTHING WAS DELETED",
			(_, true) => "MOVED TO THE TRASH",
			(_, false) => "RECLAIMED",
		};

		if left == 0 {
			let says = match (&run.disk, trash) {
				(_, true) => format!(
					"{} moved. Empty the Trash to reclaim the space.",
					plural(deleted as u64, "item")
				),
				(Some((name, usage)), false) => format!(
					"{} deleted. {name} now has {} free.",
					plural(deleted as u64, "item"),
					readable_size(usage.available + run.freed)
				),
				(None, false) => format!("{} deleted.", plural(deleted as u64, "item")),
			};
			let body = div()
				.child(
					div()
						.flex()
						.items_center()
						.gap(px(10.))
						.px(px(16.))
						.pt(px(2.))
						.child(
							div()
								.flex()
								.flex_none()
								.items_center()
								.justify_center()
								.size(px(28.))
								.rounded_full()
								.bg(p.default)
								.child(icon("check", 16., p.background)),
						)
						.child(
							div()
								.text_size(px(28.))
								.line_height(px(32.))
								.font_weight(FontWeight::SEMIBOLD)
								.child(readable_size(run.freed)),
						),
				)
				.child(div().px(px(16.)).pt(px(6.)).text_color(p.muted).child(says))
				.children(
					run.disk
						.as_ref()
						.map(|(_, usage)| disk_bar(usage, run.freed, trash, &p)),
				)
				.child(div().h(px(14.)));
			return self.card(title.into(), None, vec![dismiss], body, cx);
		}

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
		let body = div()
			.child(total(
				readable_size(run.freed),
				[
					format!("of {}", readable_size(run.size())),
					format!("{deleted} of {}", plural(count as u64, "item")),
				],
				&p,
			))
			.when(!run.failed.is_empty(), |this| {
				this.child(
					div()
						.id("cleanup-failures")
						.mx(px(16.))
						.mt(px(10.))
						.max_h(px(140.))
						.overflow_y_scroll()
						.px(px(10.))
						.rounded(px(6.))
						.border_1()
						.border_color(p.danger_border)
						.bg(p.danger_bg)
						.children(failures),
				)
			})
			.child(
				div()
					.px(px(16.))
					.pt(px(8.))
					.text_color(p.muted)
					.child(match left {
						1 => "This one is still in cleanup.".to_string(),
						left => format!("These {left} are still in cleanup."),
					}),
			)
			.child(
				footer(&p)
					.child(
						button(
							"cleanup-back",
							"Back to the queue",
							ButtonKind::Default,
							true,
							&p,
						)
						.on_click(cx.listener(|this, _, _, cx| {
							this.deletion = None;
							this.cleanup_open = true;
							cx.notify();
						})),
					)
					.when(!run.failed.is_empty(), |this| {
						this.child(
							button("cleanup-retry", "Try again", ButtonKind::Primary, true, &p)
								.on_click(cx.listener(|this, _, window, cx| {
									this.delete_failed(window, cx)
								})),
						)
					}),
			);
		self.card(title.into(), None, vec![dismiss], body, cx)
	}
}

// What turns while something's under way.
fn spinner(id: &'static str, size: f32, color: Hsla) -> AnyElement {
	icon("loader-circle", size, color)
		.with_animation(
			id,
			Animation::new(Duration::from_secs(1)).repeat(),
			|icon, t| icon.with_transformation(Transformation::rotate(percentage(t))),
		)
		.into_any_element()
}

// The card's big number, and what it's a number of beside it.
fn total(size: String, beside: [String; 2], p: &Palette) -> Div {
	let [first, second] = beside;
	div()
		.flex()
		.items_end()
		.gap(px(10.))
		.px(px(16.))
		.child(
			div()
				.flex_none()
				.text_size(px(28.))
				.line_height(px(32.))
				.font_weight(FontWeight::SEMIBOLD)
				.child(size),
		)
		.child(
			div()
				.flex_1()
				.min_w_0()
				.pb(px(2.))
				.flex()
				.flex_col()
				.items_end()
				.text_size(px(11.))
				.line_height(px(15.))
				.text_color(p.muted)
				.child(div().truncate().child(first))
				.child(div().max_w_full().truncate().child(second)),
		)
}

// What's queued as a bar, a segment each by size, in the colors their rows
// have. While they're deleted (`gone` is which have been), those that are
// gone are solid and the rest wait, pale.
fn reclaim_bar(
	store: &Store,
	items: &[(String, u64)],
	gone: Option<&[String]>,
	p: &Palette,
) -> Div {
	let size: u64 = items.iter().map(|(_, size)| size).sum();
	let segment = |share: u64, color: Hsla| {
		div()
			.h_full()
			.w(relative(share as f32 / size.max(1) as f32))
			.border_r_1()
			.border_color(p.background)
			.bg(color)
	};
	let colored = items.iter().take(SEGMENTS).map(|(path, share)| {
		let mut color = queued_color(store, path, p);
		if let Some(gone) = gone {
			if gone.contains(path) {
				color = p.default;
			} else {
				color.a = 0.45;
			}
		}
		segment(*share, color)
	});
	// Past that many, they'd be slivers: the rest are one.
	let rest: u64 = items.iter().skip(SEGMENTS).map(|(_, size)| size).sum();
	div()
		.mx(px(16.))
		.mt(px(10.))
		.h(px(8.))
		.flex()
		.rounded(px(4.))
		.overflow_hidden()
		.bg(p.fill_strong)
		.children(colored)
		.when(rest > 0, |this| this.child(segment(rest, p.faint)))
}

// The disk, with what cleanup takes off it (`reclaim`) between what's used
// and what's free. `pending` is while it's still there: before deleting, or
// in the Trash.
fn disk_bar(usage: &Usage, reclaim: u64, pending: bool, p: &Palette) -> Div {
	let whole = usage.total.max(1) as f32;
	let used = usage.used.saturating_sub(reclaim);
	let free = usage.available + reclaim;
	let mut color = reclaim_color();
	if pending {
		color.a = 0.5;
	}
	div()
		.mx(px(16.))
		.mt(px(12.))
		.px(px(12.))
		.py(px(10.))
		.rounded(px(8.))
		.border_1()
		.border_color(p.line_soft)
		.child(
			div()
				.h(px(6.))
				.flex()
				.rounded(px(3.))
				.overflow_hidden()
				.bg(p.fill_strong)
				.child(
					div()
						.h_full()
						.w(relative(used as f32 / whole))
						.bg(p.default),
				)
				.child(div().h_full().w(relative(reclaim as f32 / whole)).bg(color)),
		)
		.child(
			div()
				.mt(px(6.))
				.flex()
				.justify_between()
				.gap(px(8.))
				.text_size(px(10.))
				.line_height(px(14.))
				.text_color(p.muted)
				.child(format!("used {}", readable_size(used)))
				.child(format!("− {}", readable_size(reclaim)))
				.child(if pending {
					format!(
						"free {} → {}",
						readable_size(usage.available),
						readable_size(free)
					)
				} else {
					format!("free {}", readable_size(free))
				}),
		)
}

// The buttons along the card's bottom.
fn footer(p: &Palette) -> Div {
	div()
		.mt(px(12.))
		.flex()
		.items_center()
		.justify_end()
		.gap(px(6.))
		.px(px(12.))
		.py(px(10.))
		.border_t_1()
		.border_color(p.line_soft)
		.bg(p.fill)
		.rounded_b(px(11.))
}
