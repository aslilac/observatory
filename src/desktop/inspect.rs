// A finished scan: the sunburst of the folder the user's in, what's in it
// listed beside, and find over both.

use crate::controls::{ButtonKind, button, icon, icon_button, tip};
use crate::popup::PopupItem;
use crate::workspace::{ViewMode, Workspace};
use gpui::{
	AnyElement, App, ClickEvent, Context, Focusable, FontWeight, MouseButton, Window, deferred,
	div, prelude::*, px, relative,
};
use observatory_core::Finder;
use observatory_core::finders::{FINDERS, finder_info};
use observatory_core::format::{plural, readable_size};
use observatory_core::listing::SortMode;
use observatory_core::scans::ScanInfo;

// One of the things the find field offers while it has the focus.
enum Suggestion {
	/// Whatever has the typed text in its name.
	Name(String),
	Finder(Finder),
}

impl Workspace {
	/// What the folder find looks in is called.
	pub fn scope_name(&self) -> String {
		match (self.scope().last(), &self.tree) {
			(Some(folder), _) => folder.clone(),
			(None, Some(tree)) => tree.name.clone(),
			(None, None) => String::new(),
		}
	}

	// What the field suggests: the finders, narrowed by what's typed, under
	// looking for the typed text itself.
	fn suggestions(&self, cx: &App) -> Vec<Suggestion> {
		let typed = self.find_text(cx);
		let wanted = typed.to_lowercase();
		let mut suggestions = Vec::new();
		if !typed.is_empty() {
			suggestions.push(Suggestion::Name(typed));
		}
		suggestions.extend(
			FINDERS
				.iter()
				.filter(|info| info.label.to_lowercase().contains(&wanted))
				.map(|info| Suggestion::Finder(info.finder)),
		);
		suggestions
	}

	pub fn move_suggestion(&mut self, by: i32, cx: &mut Context<Self>) {
		let count = self.suggestions(cx).len() as i32;
		if count > 0 {
			self.suggestion = (self.suggestion as i32 + by).rem_euclid(count) as usize;
			cx.notify();
		}
	}

	pub fn pick_suggestion(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
		match self.suggestions(cx).get(index) {
			Some(Suggestion::Finder(finder)) => self.pick_finder(*finder, window, cx),
			// What's typed is already being looked for: this just puts the
			// suggestions away.
			_ => window.focus(&self.focus),
		}
	}

	pub fn render_inspect(
		&mut self,
		scan: &ScanInfo,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> AnyElement {
		let p = self.palette;
		let finding = self.finding_something(cx);

		let mode_button = |mode: ViewMode, name: &'static str, says: &'static str| {
			let on = self.mode == mode;
			div()
				.id(name)
				.flex()
				.items_center()
				.justify_center()
				.w(px(30.))
				.h(px(22.))
				.rounded(px(4.))
				.cursor_pointer()
				.when(on, |this| this.bg(p.fill_strong))
				.child(icon(name, 14., if on { p.default } else { p.muted }))
				.tooltip(tip(says))
				.on_click(cx.listener(move |this, _, _, cx| {
					if this.mode != mode {
						this.mode = mode;
						// The tree has no place for what find found.
						this.clear_find(cx);
						cx.notify();
					}
				}))
		};
		let segmented = div()
			.flex()
			.flex_none()
			.gap(px(2.))
			.p(px(1.))
			.rounded(px(6.))
			.border_1()
			.border_color(p.line)
			.child(mode_button(ViewMode::List, "list", "List"))
			.child(mode_button(ViewMode::Tree, "list-tree", "Tree"))
			.into_any_element();
		let mut chips = Vec::new();
		chips.extend(self.render_issues_chip(scan, cx));
		chips.push(self.render_cleanup_chip(cx));
		let toolbar = self.render_toolbar(Some(segmented), chips, window, cx);

		let find_bar = self.render_find_bar(finding, cx);
		let side = if finding {
			self.render_find_results(cx)
		} else if self.mode == ViewMode::Tree {
			self.render_folder_tree(&scan.path, cx)
		} else {
			self.render_legend(&scan.path, cx)
		};
		let selection = self.render_selection_bar(cx);
		let sunburst = self.render_sunburst(cx);

		div()
			.flex()
			.flex_col()
			.size_full()
			.child(toolbar)
			.child(find_bar)
			.child(
				div()
					.flex_1()
					.min_h_0()
					.flex()
					.child(
						// What's checked floats over the sunburst's side, clear
						// of the corner cleanup speaks from.
						div()
							.relative()
							.flex_1()
							.min_w_0()
							.flex()
							.child(sunburst)
							.children(selection),
					)
					.child(
						div()
							.id("side")
							.flex_none()
							.w(relative(1. / 3.))
							.min_w(px(340.))
							.max_w(px(600.))
							.h_full()
							.overflow_y_scroll()
							.p(px(16.))
							.child(side),
					),
			)
			.into_any_element()
	}

	// The field over the sunburst, with what it suggests under it while it
	// has the focus, and how the list is sorted at its right.
	fn render_find_bar(&self, finding: bool, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let scope_name = self.scope_name();
		self.find_input.update(cx, |input, _| {
			input.placeholder = if self.finder.is_some() {
				"".into()
			} else {
				format!("Find in {scope_name}…").into()
			};
		});
		let input_focus = self.find_input.focus_handle(cx);

		let finder_chip = self.finder.map(|finder| {
			div()
				.id("finder-chip")
				.flex()
				.flex_none()
				.items_center()
				.gap(px(4.))
				.h(px(20.))
				.pl(px(8.))
				.pr(px(4.))
				.rounded(px(4.))
				.bg(p.fill_strong)
				.text_size(px(12.))
				.child(finder_info(finder).label)
				.child(
					div()
						.id("finder-chip-x")
						.cursor_pointer()
						.child(icon("x", 12., p.muted))
						.on_click(cx.listener(|this, _, _, cx| {
							cx.stop_propagation();
							this.clear_finder(cx);
						})),
				)
		});

		let field = div()
			.id("find-field")
			.flex()
			.items_center()
			.gap(px(8.))
			.h(px(32.))
			.px(px(10.))
			.rounded(px(8.))
			.border_1()
			.border_color(if self.suggesting { p.muted } else { p.line })
			.child(icon("search", 14., p.muted))
			.children(finder_chip)
			.child(div().flex_1().min_w_0().child(self.find_input.clone()))
			.when(finding, |this| {
				this.child(
					icon_button("find-clear", "x", true, &p)
						.size(px(20.))
						.on_click(cx.listener(|this, _, _, cx| {
							cx.stop_propagation();
							this.clear_find(cx);
						})),
				)
			})
			.on_click(move |_, window, _| window.focus(&input_focus));

		let suggestions = self
			.suggesting
			.then(|| self.render_suggestions(&scope_name, cx));

		let sort = (!finding && self.mode == ViewMode::List).then(|| {
			let fill = p.fill;
			div()
				.id("sort")
				.flex()
				.flex_none()
				.items_center()
				.gap(px(4.))
				.h(px(32.))
				.px(px(10.))
				.rounded(px(8.))
				.text_size(px(12.))
				.text_color(p.muted)
				.cursor_pointer()
				.hover(move |style| style.bg(fill))
				.child(format!("Sort: {}", self.sort.label()))
				.child(icon("chevron-down", 12., p.faint))
				.on_click(cx.listener(|this, event: &ClickEvent, _, cx| {
					let items = SortMode::ALL
						.into_iter()
						.map(|mode| {
							PopupItem::action(mode.label(), move |this, _, _| {
								this.sort = mode;
								this.show_all = false;
							})
							.checked(this.sort == mode)
						})
						.collect();
					this.show_popup(event.position(), items, cx);
				}))
		});

		div()
			.flex()
			.flex_none()
			.items_center()
			.gap(px(8.))
			.px(px(16.))
			.pt(px(12.))
			.child(
				div()
					.relative()
					.flex_1()
					.min_w_0()
					.child(field)
					.children(suggestions),
			)
			.children(sort)
			.into_any_element()
	}

	fn render_suggestions(&self, scope_name: &str, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let rows = self
			.suggestions(cx)
			.into_iter()
			.enumerate()
			.map(|(index, suggestion)| {
				let (name, label, description, found) = match &suggestion {
					Suggestion::Name(typed) => (
						"text-search",
						format!("Names with “{typed}”"),
						format!("In {scope_name}"),
						None,
					),
					Suggestion::Finder(finder) => {
						let info = finder_info(*finder);
						// How much it finds here, once that's been counted.
						let found = self.summaries.as_ref().map(|summaries| {
							match summaries.iter().find(|summary| summary.finder == *finder) {
								Some(summary) if summary.count > 0 => format!(
									"{} · {}",
									readable_size(summary.size),
									plural(summary.count, "item")
								),
								_ => "None".to_string(),
							}
						});
						(
							info.icon,
							info.label.to_string(),
							info.description.to_string(),
							found,
						)
					}
				};
				div()
					.id(("suggestion", index))
					.flex()
					.items_center()
					.gap(px(10.))
					.px(px(10.))
					.py(px(6.))
					.rounded(px(5.))
					.cursor_pointer()
					.when(index == self.suggestion, |this| this.bg(p.fill))
					.hover(move |style| style.bg(p.fill))
					.child(icon(name, 15., p.muted))
					.child(
						div()
							.flex_1()
							.min_w_0()
							.child(div().truncate().child(label))
							.child(
								div()
									.truncate()
									.text_size(px(11.))
									.line_height(px(15.))
									.text_color(p.muted)
									.child(description),
							),
					)
					.children(found.map(|found| {
						div()
							.flex_none()
							.text_size(px(12.))
							.text_color(p.muted)
							.child(found)
					}))
					// On the way down, not up: the press would take the focus
					// from the field, and the suggestions with it.
					.on_mouse_down(
						MouseButton::Left,
						cx.listener(move |this, _, window, cx| {
							cx.stop_propagation();
							window.prevent_default();
							this.pick_suggestion(index, window, cx);
						}),
					)
			});
		deferred(
			div()
				.absolute()
				.top(px(36.))
				.left_0()
				.w_full()
				.occlude()
				.p(px(4.))
				.rounded(px(8.))
				.bg(p.background)
				.border_1()
				.border_color(p.line)
				.shadow_lg()
				.children(rows),
		)
		.with_priority(1)
		.into_any_element()
	}

	// What's checked and what to do with it, floating at the bottom while
	// anything is. There's no bar there otherwise: how big the folder is is
	// in the middle of the sunburst, and what's reserved and free is in the
	// list.
	fn render_selection_bar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		if self.selection.is_empty() {
			return None;
		}
		let p = self.palette;
		let size: u64 = self.selection.iter().map(|item| item.size).sum();
		let bar = div()
			.id("selection")
			.occlude()
			.flex()
			.items_center()
			.gap(px(10.))
			.pl(px(14.))
			.pr(px(8.))
			.py(px(8.))
			.rounded(px(10.))
			.bg(p.background)
			.border_1()
			.border_color(p.line)
			.shadow_lg()
			.child(
				div()
					.font_weight(FontWeight::MEDIUM)
					.child(format!("{} selected", self.selection.len())),
			)
			.child(div().text_color(p.muted).child(readable_size(size)))
			.child(
				button(
					"selection-cleanup",
					"Move to cleanup",
					ButtonKind::Primary,
					true,
					&p,
				)
				.ml(px(6.))
				.on_click(cx.listener(|this, _, _, cx| this.move_selected_to_cleanup(cx))),
			)
			.child(
				icon_button("selection-cancel", "x", true, &p)
					.tooltip(tip("Clear the selection"))
					.on_click(cx.listener(|this, _, _, cx| {
						this.selection.clear();
						cx.notify();
					})),
			);
		Some(
			div()
				.absolute()
				.bottom(px(14.))
				.left_0()
				.right_0()
				.flex()
				.justify_center()
				.child(bar)
				.into_any_element(),
		)
	}
}
