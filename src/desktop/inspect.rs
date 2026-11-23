// A finished scan: the sunburst of the folder the user's in, what's in it
// listed beside, and find over both.

use crate::cleanup::{Card, Cleanup, Drag, DraggedItems};
use crate::controls::{ButtonKind, button, icon_button, tip};
use crate::find::{Field, Find};
use crate::issues::IssuesModal;
use crate::lists::CHECKBOX_MARGIN;
use crate::palette::Palette;
use crate::sunburst::Sunburst;
use crate::workspace::Workspace;
use gpui::{
	AnyElement, App, Context, DragMoveEvent, FocusHandle, FontWeight, Window, div, prelude::*, px,
	relative,
};
use observatory_core::color;
use observatory_core::format::readable_size;
use observatory_core::listing::SortMode;
use observatory_core::reserved::{ReservedGroup, group_reserved};
use observatory_core::scans::ScanInfo;
use observatory_core::sunburst::{LayoutInput, View, layout_wedges};
use observatory_core::tree::{Item, RenderTree};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// A finished scan as it's on screen: the folder of it that's showing, and
/// everything the user has going over it. It's there for as long as the scan
/// is on screen, whichever of its folders they're in, and gone when they
/// leave.
pub struct Inspect {
	/// The folder that's showing: a slice of the scan's tree.
	pub tree: Arc<RenderTree>,
	/// The scan's revision when `tree` was cut from it.
	pub revision: u64,
	// What's worked out from `tree` when it's laid out: what Windows keeps
	// for itself, in groups, and the hue each thing in the list has.
	pub reserved: Vec<ReservedGroup>,
	pub hues: HashMap<String, f64>,
	pub sunburst: Sunburst,

	pub sort: SortMode,
	pub show_all: bool,
	/// What's checked, in the order it was.
	pub selection: Vec<Item>,

	pub find: Find,
	pub cleanup: Cleanup,
	/// The modal that lists what the scan couldn't read, while it's up.
	pub issues: Option<IssuesModal>,
}

impl Inspect {
	/// The folder `tree` of `scan`, with nothing going on over it yet.
	pub fn new(
		tree: Arc<RenderTree>,
		scan: &ScanInfo,
		palette: &Palette,
		now: Duration,
		window: &mut Window,
		cx: &mut Context<Workspace>,
	) -> Self {
		let mut this = Self {
			tree,
			revision: scan.revision,
			reserved: Vec::new(),
			hues: HashMap::new(),
			sunburst: Sunburst::new(),
			sort: SortMode::Size,
			show_all: false,
			selection: Vec::new(),
			find: Find::new(palette, window, cx),
			cleanup: Cleanup::new(),
			issues: None,
		};
		this.lay_out(&scan.path, palette.dark, now, false);
		this
	}

	/// Works out the sunburst's wedges for `tree`, and has it show them.
	/// `root` is the scan's.
	pub fn lay_out(&mut self, root: &str, dark: bool, now: Duration, still: bool) {
		let tree = &self.tree;
		self.reserved = group_reserved(&tree.reserved);
		self.hues = tree
			.list
			.iter()
			.map(|file| file.name.clone())
			.zip(color::hues_by_position(
				tree.list.iter().map(|file| file.size),
				tree.position,
				tree.root_size,
			))
			.collect();
		let wedges = layout_wedges(&LayoutInput {
			root,
			cursor: &tree.cursor,
			files: &tree.sunburst,
			capacity: tree.capacity,
			size: tree.size,
			root_size: tree.root_size,
			position: tree.position,
			reserved: &self.reserved,
			dark,
		});
		let view = View {
			root: root.to_string(),
			cursor: tree.cursor.clone(),
			span: if tree.capacity > 0 {
				tree.size as f64 / tree.capacity as f64
			} else {
				0.0
			},
		};
		self.sunburst.show(view, wedges, now, still);
	}

	// What's checked.

	pub fn is_selected(&self, path: &str) -> bool {
		self.selection.iter().any(|item| item.path == path)
	}

	pub fn toggle_selected(&mut self, item: &Item) {
		match self.selection.iter().position(|it| it.path == item.path) {
			Some(at) => {
				self.selection.remove(at);
			}
			None => self.selection.push(item.clone()),
		}
	}

	/// What a drag of `item` carries: everything checked, if it's one of
	/// them, or just it.
	pub fn dragged_with(&self, item: &Item) -> Vec<Item> {
		if self.is_selected(&item.path) {
			self.selection.clone()
		} else {
			vec![item.clone()]
		}
	}

	/// Escape, once nothing over the window took it: shuts the topmost thing
	/// that's open here, or failing that clears what's found, then what's
	/// checked. `focus` is the window's, for taking the keys back from the
	/// find field.
	pub fn escape(&mut self, focus: &FocusHandle, window: &mut Window, cx: &mut App) {
		if self.cleanup.card == Card::Confirming {
			self.cleanup.card = Card::Queue;
		} else if self.issues.take().is_some() {
		} else if let Field::Suggesting { .. } = self.find.field {
			window.focus(focus);
		} else if self.find.search.is_some() {
			self.find.clear(cx);
		} else if self.cleanup.card != Card::Shut {
			self.cleanup.card = Card::Shut;
		} else {
			self.selection.clear();
		}
	}
}

impl Workspace {
	pub fn toggle_selected(&mut self, item: &Item, cx: &mut Context<Self>) {
		if let Some((_, inspect)) = self.screen.inspecting_mut() {
			inspect.toggle_selected(item);
			cx.notify();
		}
	}

	pub fn render_inspect(
		&self,
		root: &str,
		inspect: &Inspect,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> AnyElement {
		let mut chips = Vec::new();
		chips.extend(self.render_issues_chip(root, cx));
		let tools = self.render_find_tools(inspect, cx);
		// Find's field is a good deal wider than the button for it.
		let tools_width = if inspect.find.showing() { 340. } else { 80. };
		let toolbar = self.render_toolbar(Some((tools, tools_width)), chips, window, cx);
		// What a query finds takes the list's place.
		let side = match &inspect.find.search {
			Some(search) => self.render_find_results(root, inspect, search, cx),
			None => self.render_legend(root, inspect, cx),
		};
		let selection = self.render_selection_bar(inspect, cx);
		let selecting = selection.is_some();
		let sunburst = self.render_sunburst(inspect, cx);

		div()
			.id("inspect")
			.relative()
			.flex()
			.flex_col()
			.size_full()
			// Something of the scan's being dragged brings out somewhere to
			// drop it (cleanup's landing pad), which says how much would be
			// added.
			.on_drag_move(
				cx.listener(|this, event: &DragMoveEvent<DraggedItems>, _, cx| {
					let Some((root, inspect)) = this.screen.inspecting_mut() else {
						return;
					};
					if inspect.cleanup.drag.is_none() {
						let size = event
							.drag(cx)
							.0
							.iter()
							.filter(|item| !this.store.in_cleanup(root, &item.path))
							.map(|item| item.size)
							.sum();
						inspect.cleanup.drag = Some(Drag { size, over: false });
						cx.notify();
					}
				}),
			)
			.child(toolbar)
			.child(
				div().flex_1().min_h_0().flex().child(sunburst).child(
					// What's checked floats at the bottom of the list it's
					// checked in; cleanup has the other corner.
					div()
						.relative()
						.flex_none()
						.w(relative(1. / 3.))
						.min_w(px(340.))
						.max_w(px(600.))
						.h_full()
						.child(
							div()
								.id("side")
								.size_full()
								.overflow_y_scroll()
								.p(px(16.))
								// The rows' checkboxes are in this margin.
								.pl(px(CHECKBOX_MARGIN + 5.))
								// Room to scroll the last rows out from
								// under it.
								.when(selecting, |this| this.pb(px(72.)))
								.child(side),
						)
						.children(selection),
				),
			)
			.child(self.render_cleanup(root, inspect, window, cx))
			.into_any_element()
	}

	// What's checked and what to do with it, floating at the bottom while
	// anything is. There's no bar there otherwise: how big the folder is is
	// in the middle of the sunburst, and what's reserved and free is in the
	// list.
	fn render_selection_bar(
		&self,
		inspect: &Inspect,
		cx: &mut Context<Self>,
	) -> Option<AnyElement> {
		if inspect.selection.is_empty() {
			return None;
		}
		let p = self.palette;
		let size: u64 = inspect.selection.iter().map(|item| item.size).sum();
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
					.child(format!("{} selected", inspect.selection.len())),
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
						if let Some((_, inspect)) = this.screen.inspecting_mut() {
							inspect.selection.clear();
						}
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
