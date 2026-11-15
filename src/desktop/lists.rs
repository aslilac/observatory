// What's beside the sunburst: the list of what's in the folder (its
// legend), or what find found.

use crate::cleanup::draggable;
use crate::controls::{ButtonKind, button, checkbox, icon, icon_button, tip};
use crate::palette::hsla;
use crate::popup::item_menu;
use crate::workspace::Workspace;
use gpui::{
	AnyElement, Context, Div, ElementId, FontWeight, Hsla, MouseButton, MouseDownEvent, Stateful,
	div, prelude::*, px,
};
use observatory_core::Finder;
use observatory_core::color::{Kind, sunburst_color};
use observatory_core::finders::finder_info;
use observatory_core::format::{grouped, now_ms, plural, readable_date, readable_size};
use observatory_core::listing::listing;
use observatory_core::paths::{basename, join_path};
use observatory_core::tree::{Item, Node};

// A dot of one of the sunburst's colors, or a ring for what has none.
fn dot(color: Option<Hsla>, outline: Hsla) -> Div {
	let dot = div().flex_none().size(px(8.)).rounded_full();
	match color {
		Some(color) => dot.bg(color),
		None => dot.border_1().border_color(outline),
	}
}

fn size_column(size: u64, color: Hsla) -> Div {
	div()
		.flex_none()
		.w(px(68.))
		.text_right()
		.text_size(px(12.))
		.text_color(color)
		.child(readable_size(size))
}

impl Workspace {
	// A row about a file or folder: it highlights, has the item's menu on a
	// right-click, and drags to cleanup.
	fn item_row(
		&self,
		id: impl Into<ElementId>,
		item: &Item,
		cx: &mut Context<Self>,
	) -> Stateful<Div> {
		let p = self.palette;
		let for_menu = item.clone();
		let row = div()
			.id(id)
			.flex()
			.items_center()
			.gap(px(8.))
			.px(px(8.))
			.py(px(7.))
			.rounded(px(5.))
			.cursor_pointer()
			.when(self.is_selected(&item.path), |this| this.bg(p.fill))
			.hover(move |style| style.bg(p.fill))
			.on_mouse_down(
				MouseButton::Right,
				cx.listener(move |this, event: &MouseDownEvent, _, cx| {
					this.show_popup(event.position, item_menu(&for_menu), cx)
				}),
			);
		draggable(row, self.dragged_with(item), p)
	}

	fn item_checkbox(
		&self,
		id: impl Into<ElementId>,
		item: &Item,
		cx: &mut Context<Self>,
	) -> Stateful<Div> {
		let p = self.palette;
		let item = item.clone();
		checkbox(id, self.is_selected(&item.path), &p).on_click(cx.listener(
			move |this, _, _, cx| {
				cx.stop_propagation();
				this.toggle_selected(&item, cx);
			},
		))
	}

	// A file or folder's name, as the lists write it: a folder's with a
	// slash, and struck through once it's queued for cleanup.
	fn item_name(&self, item: &Item) -> Div {
		let p = self.palette;
		let queued = self.store.in_cleanup(&item.path);
		div()
			.flex_1()
			.min_w_0()
			.flex()
			.child(
				div()
					.truncate()
					.text_color(if queued {
						p.faint
					} else if item.directory {
						p.default
					} else {
						p.muted
					})
					.when(queued, |this| this.line_through())
					.child(item.name.clone()),
			)
			.when(item.directory, |this| {
				this.child(div().flex_none().text_color(p.faint).child("/"))
			})
	}

	/// What's in the folder, largest first unless sorted otherwise, each with
	/// its color in the sunburst.
	pub fn render_legend(&self, root: &str, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let Some(tree) = &self.tree else {
			return div().into_any_element();
		};
		let listed = listing(&tree.list, self.sort, self.show_all);
		let dates = self.sort.shows_dates();
		let now = now_ms();
		let depth = tree.cursor.len();
		let item_of = |node: &Node| Item {
			path: join_path(root, tree.cursor.iter().chain(std::iter::once(&node.name))),
			name: node.name.clone(),
			size: node.size,
			directory: node.directory,
		};

		let rows = listed.visible.iter().enumerate().map(|(index, node)| {
			let item = item_of(node);
			let kind = if node.directory {
				Kind::Directory
			} else {
				Kind::File
			};
			let hue = self.hues.get(&node.name).copied().unwrap_or(0.0);
			let (name, for_click) = (node.name.clone(), item.clone());
			let directory = node.directory;
			self.item_row(("legend", index), &item, cx)
				.child(self.item_checkbox(("legend-check", index), &item, cx))
				.child(dot(
					Some(hsla(sunburst_color(hue, depth, kind, p.dark))),
					p.line,
				))
				.child(icon(
					if directory { "folder" } else { "file" },
					13.,
					p.faint,
				))
				.child(self.item_name(&item))
				.when(dates, |this| {
					this.child(
						div()
							.flex_none()
							.w(px(88.))
							.text_right()
							.text_size(px(11.))
							.text_color(p.faint)
							.child(readable_date(node.mtime, now)),
					)
				})
				.child(size_column(node.size, p.muted))
				.on_click(cx.listener(move |this, _, window, cx| {
					if directory {
						this.enter(std::slice::from_ref(&name), window, cx);
					} else {
						this.toggle_selected(&for_click, cx);
					}
				}))
		});

		// Under the files: what else the disk's space goes to.
		let reserved: u64 = self.reserved.iter().map(|group| group.size).sum();
		let free = tree.capacity.saturating_sub(tree.size + reserved);
		let footer_row = |dot: Div, label: &'static str, size: u64| {
			div()
				.flex()
				.items_center()
				.gap(px(8.))
				.px(px(8.))
				.py(px(5.))
				.child(div().w(px(14.)).flex_none())
				.child(dot)
				.child(div().flex_1().text_color(p.muted).child(label))
				.child(size_column(size, p.muted))
		};
		let gray = hsla(sunburst_color(0.0, 0, Kind::Reserved, p.dark));
		let footer = (free > 0 || !self.reserved.is_empty()).then(|| {
			div()
				.mt(px(6.))
				.pt(px(6.))
				.border_t_1()
				.border_color(p.line_soft)
				.children(
					self.reserved
						.iter()
						.map(|group| footer_row(dot(Some(gray), p.line), group.label, group.size)),
				)
				.when(free > 0, |this| {
					this.child(footer_row(dot(None, p.faint), "free space", free))
				})
		});

		div()
			.flex()
			.flex_col()
			.child(
				div()
					.flex()
					.items_baseline()
					.justify_between()
					.gap(px(12.))
					.px(px(8.))
					.pb(px(8.))
					.mb(px(6.))
					.border_b_1()
					.border_color(p.line)
					.child(
						div()
							.min_w_0()
							.truncate()
							.text_size(px(14.))
							.font_weight(FontWeight::SEMIBOLD)
							.child(tree.cursor.last().unwrap_or(&tree.name).clone()),
					)
					.child(
						div()
							.flex_none()
							.text_color(p.muted)
							.child(readable_size(tree.size)),
					),
			)
			.children(rows)
			.when(listed.visible.len() < listed.total, |this| {
				this.child(
					div().flex().px(px(8.)).py(px(8.)).child(
						button(
							"show-all",
							format!("Show all {} items", grouped(listed.total as u64)),
							ButtonKind::Default,
							true,
							&p,
						)
						.on_click(cx.listener(|this, _, _, cx| {
							this.show_all = true;
							cx.notify();
						})),
					),
				)
			})
			.when(listed.total == 0, |this| {
				this.child(
					div()
						.px(px(8.))
						.py(px(12.))
						.text_color(p.muted)
						.child("This folder is empty."),
				)
			})
			.children(footer)
			.into_any_element()
	}

	/// What the query found, in the list's place, largest first.
	pub fn render_find_results(&self, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let text = self.find_text(cx);
		let scope = self.scope();
		let scope_name = self.scope_name();
		let title = match self.finder {
			Some(finder) if text.is_empty() => finder_info(finder).label.to_string(),
			_ => format!("Names with “{text}”"),
		};
		let dates = self.finder == Some(Finder::Old) && text.is_empty();
		let now = now_ms();
		let found = self.found.clone();

		let subtitle = match &found {
			Some(found) => format!(
				"{} in {scope_name} · {}",
				plural(found.total_count, "item"),
				readable_size(found.total_size)
			),
			None => format!("In {scope_name}"),
		};
		let items: Vec<Item> = found
			.iter()
			.flat_map(|found| &found.matches)
			.map(|found| Item {
				path: found.path.clone(),
				name: basename(&found.path).to_string(),
				size: found.size,
				directory: found.kind == "directory",
			})
			.collect();
		let truncated = found.as_ref().is_some_and(|found| found.truncated);

		let rows: Vec<_> = found
			.iter()
			.flat_map(|found| &found.matches)
			.zip(&items)
			.enumerate()
			.map(|(index, (found, item))| {
				let mut to = scope.clone();
				to.extend(found.within.iter().cloned());
				self.item_row(("found", index), item, cx)
					.child(self.item_checkbox(("found-check", index), item, cx))
					.child(icon(
						if item.directory { "folder" } else { "file" },
						13.,
						p.faint,
					))
					.child(
						div()
							.flex_1()
							.min_w_0()
							.flex()
							.flex_col()
							.child(self.item_name(item))
							.when(!found.within.is_empty(), |this| {
								this.child(
									div()
										.truncate()
										.text_size(px(11.))
										.line_height(px(15.))
										.text_color(p.faint)
										.child(format!("in {}", found.within.join(" › "))),
								)
							}),
					)
					.when(dates, |this| {
						this.child(
							div()
								.flex_none()
								.w(px(88.))
								.text_right()
								.text_size(px(11.))
								.text_color(p.faint)
								.child(readable_date(found.modified, now)),
						)
					})
					.child(size_column(found.size, p.muted))
					// Shows where it is: the folder it's in, in the sunburst.
					.on_click(cx.listener(move |this, _, window, cx| {
						this.set_cursor(to.clone(), window, cx)
					}))
			})
			.collect();

		let all = items.clone();
		div()
			.flex()
			.flex_col()
			.child(
				div()
					.flex()
					.items_center()
					.gap(px(8.))
					.px(px(4.))
					.pb(px(8.))
					.mb(px(6.))
					.border_b_1()
					.border_color(p.line)
					.child(
						icon_button("find-back", "arrow-left", true, &p)
							.tooltip(tip("Back to the list"))
							.on_click(cx.listener(|this, _, _, cx| this.clear_find(cx))),
					)
					.child(
						div()
							.flex_1()
							.min_w_0()
							.child(
								div()
									.truncate()
									.text_size(px(14.))
									.font_weight(FontWeight::SEMIBOLD)
									.child(title),
							)
							.child(
								div()
									.truncate()
									.text_size(px(11.))
									.line_height(px(15.))
									.text_color(p.muted)
									.child(subtitle),
							),
					)
					.when(!items.is_empty(), |this| {
						this.child(
							button(
								"find-all-to-cleanup",
								if truncated {
									format!("Move top {} to cleanup", grouped(items.len() as u64))
								} else {
									"Move all to cleanup".to_string()
								},
								ButtonKind::Default,
								true,
								&p,
							)
							.on_click(cx.listener(move |this, _, _, cx| {
								this.move_to_cleanup(all.clone(), cx)
							})),
						)
					}),
			)
			.children(rows)
			.when(items.is_empty(), |this| {
				this.child(div().px(px(8.)).py(px(12.)).text_color(p.muted).child(
					if found.is_none() || self.finding {
						"Looking…"
					} else {
						"Nothing here."
					},
				))
			})
			.when(truncated, |this| {
				this.child(
					div()
						.px(px(8.))
						.py(px(10.))
						.text_size(px(11.))
						.text_color(p.faint)
						.child(format!(
							"Only the {} largest are listed.",
							grouped(items.len() as u64)
						)),
				)
			})
			.into_any_element()
	}
}
