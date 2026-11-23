// Find: how the user looks for what there is to clean up in a scan. A
// field in the toolbar (a button until it's wanted) that suggests the finders
// while it has the focus, and what a query finds, which takes the list's
// place (lists.rs) until it's cleared.

use crate::controls::{icon, icon_button, tip};
use crate::inspect::Inspect;
use crate::palette::Palette;
use crate::popup::{MenuButton, PopupItem};
use crate::text_input::{self, TextInput};
use crate::workspace::Workspace;
use gpui::{
	AnyElement, App, AppContext, Context, Corner, Entity, Focusable, MouseButton, Subscription,
	Task, Window, deferred, div, prelude::*, px,
};
use observatory_core::finders::{FINDERS, finder_info};
use observatory_core::format::{plural, readable_size};
use observatory_core::listing::SortMode;
use observatory_core::{Finder, Found, Query, Summary};
use std::sync::Arc;
use std::time::Duration;

// How wide the find field is in the toolbar, and what it suggests under it.
const FIND_WIDTH: f32 = 280.;
const SUGGESTIONS_WIDTH: f32 = 380.;

/// Find, over one scan's results.
pub struct Find {
	pub input: Entity<TextInput>,
	pub field: Field,
	/// What's being looked for, while there's a query.
	pub search: Option<Search>,
	// How much each finder finds, for the suggestions, once they've been up.
	summaries: Option<Summaries>,
	// What the workspace hears of `input`, for as long as this is there.
	_listening: [Subscription; 4],
}

/// How the field is in the toolbar.
#[derive(Clone, Copy, PartialEq)]
pub enum Field {
	/// A button, or with a query, the field with that in it.
	Resting,
	/// It's been asked for, and is about to have the focus.
	Wanted,
	/// It has the focus, and suggests what to look for under it. `picked`
	/// is the one the arrows are on.
	Suggesting { picked: usize },
}

/// A query, and what's come of it. It looks in the folder that was showing
/// when the query started, and keeps to it while the user goes through the
/// matches in the sunburst.
pub struct Search {
	pub query: Query,
	pub scope: Vec<String>,
	/// What it found, the last time it finished looking.
	pub found: Option<Arc<Found>>,
	// It's looking: dropped, it stops, so a query that's been replaced never
	// comes back with what it found.
	looking: Option<Task<()>>,
}

impl Search {
	pub fn looking(&self) -> bool {
		self.looking.is_some()
	}

	/// The finder it's a query of, if it's of one.
	pub fn finder(&self) -> Option<Finder> {
		match self.query {
			Query::Finder(finder) => Some(finder),
			Query::Name(_) => None,
		}
	}
}

// How much each finder finds below a folder (`scope`) of the scan as it was
// at `revision`.
struct Summaries {
	scope: Vec<String>,
	revision: u64,
	// None until they've been counted.
	sizes: Option<Arc<Vec<Summary>>>,
	_counting: Task<()>,
}

// One of the things the find field offers while it has the focus.
enum Suggestion {
	/// Whatever has the typed text in its name.
	Name(String),
	Finder(Finder),
}

impl Find {
	pub fn new(palette: &Palette, window: &mut Window, cx: &mut Context<Workspace>) -> Self {
		let input = cx.new(|cx| {
			let mut input = TextInput::new("Find…", cx);
			input.placeholder_color = palette.faint;
			input
		});
		let focus = input.focus_handle(cx);
		let listening = [
			cx.subscribe_in(&input, window, |this, _, _: &text_input::Changed, _, cx| {
				this.find_text_changed(cx)
			}),
			// Backspace in the empty field takes the finder's chip away.
			cx.subscribe_in(
				&input,
				window,
				|this, _, _: &text_input::BackspacedEmpty, _, cx| this.clear_finder(cx),
			),
			cx.on_focus(&focus, window, |this, _, cx| {
				if let Some((_, inspect)) = this.screen.inspecting_mut() {
					inspect.find.field = Field::Suggesting { picked: 0 };
				}
				this.load_summaries(cx);
				cx.notify();
			}),
			cx.on_blur(&focus, window, |this, _, cx| {
				if let Some((_, inspect)) = this.screen.inspecting_mut() {
					inspect.find.field = Field::Resting;
				}
				cx.notify();
			}),
		];
		Self {
			input,
			field: Field::Resting,
			search: None,
			summaries: None,
			_listening: listening,
		}
	}

	/// What's typed in the field.
	pub fn text(&self, cx: &App) -> String {
		self.input.read(cx).text().trim().to_string()
	}

	/// The folder find looks in: where the query started, or `cursor`, where
	/// the user is.
	pub fn scope(&self, cursor: &[String]) -> Vec<String> {
		match &self.search {
			Some(search) => search.scope.clone(),
			None => cursor.to_vec(),
		}
	}

	/// The finder that's being looked with, which the field has a chip for.
	pub fn finder(&self) -> Option<Finder> {
		self.search.as_ref().and_then(Search::finder)
	}

	/// Whether the toolbar has the field, rather than the button for it.
	pub fn showing(&self) -> bool {
		self.field != Field::Resting || self.search.is_some()
	}

	// Has `query` be what's looked for. One that takes another's place looks
	// where that one did, and keeps what it found until there's more.
	fn ask(&mut self, query: Query, cursor: &[String]) {
		match &mut self.search {
			Some(search) => search.query = query,
			None => {
				self.search = Some(Search {
					query,
					scope: cursor.to_vec(),
					found: None,
					looking: None,
				})
			}
		}
	}

	/// No query, and nothing in the field.
	pub fn clear(&mut self, cx: &mut App) {
		self.input.update(cx, |input, cx| input.set_text("", cx));
		self.search = None;
	}

	// What the field suggests: the finders, narrowed by what's typed, under
	// looking for the typed text itself.
	fn suggestions(&self, cx: &App) -> Vec<Suggestion> {
		let typed = self.text(cx);
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
}

impl Inspect {
	/// What the folder find looks in is called.
	pub fn scope_name(&self) -> String {
		match &self.find.search {
			Some(Search { scope, .. }) => scope.last(),
			None => self.tree.cursor.last(),
		}
		.unwrap_or(&self.tree.name)
		.clone()
	}
}

impl Workspace {
	/// Brings out the find field, which is a button in the toolbar until
	/// it's wanted, and puts the cursor in it.
	pub fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some((_, inspect)) = self.screen.inspecting_mut() else {
			return;
		};
		if inspect.find.field == Field::Resting {
			inspect.find.field = Field::Wanted;
		}
		let focus = inspect.find.input.focus_handle(cx);
		window.focus(&focus);
		cx.notify();
	}

	fn find_text_changed(&mut self, cx: &mut Context<Self>) {
		let Some((_, inspect)) = self.screen.inspecting_mut() else {
			return;
		};
		let find = &mut inspect.find;
		let text = find.text(cx);
		if let Field::Suggesting { picked } = &mut find.field {
			*picked = 0;
		}
		if !text.is_empty() {
			// Typing takes a finder's place.
			find.ask(Query::Name(text), &inspect.tree.cursor);
			self.run_find(true, cx);
		} else if find.finder().is_none() {
			find.search = None;
			cx.notify();
		}
	}

	pub fn pick_finder(&mut self, finder: Finder, window: &mut Window, cx: &mut Context<Self>) {
		let Some((_, inspect)) = self.screen.inspecting_mut() else {
			return;
		};
		inspect
			.find
			.ask(Query::Finder(finder), &inspect.tree.cursor);
		inspect
			.find
			.input
			.update(cx, |input, cx| input.set_text("", cx));
		window.focus(&self.focus);
		self.run_find(false, cx);
	}

	/// Takes the finder's chip away, and what it found.
	pub fn clear_finder(&mut self, cx: &mut Context<Self>) {
		if let Some((_, inspect)) = self.screen.inspecting_mut()
			&& inspect.find.finder().is_some()
		{
			inspect.find.search = None;
			cx.notify();
		}
	}

	pub fn clear_find(&mut self, cx: &mut Context<Self>) {
		if let Some((_, inspect)) = self.screen.inspecting_mut() {
			inspect.find.clear(cx);
			cx.notify();
		}
	}

	/// Looks for whatever the query is now, off to the side. A name being
	/// typed waits a moment for the next letter (`settle`).
	pub fn run_find(&mut self, settle: bool, cx: &mut Context<Self>) {
		let scans = self.scans.clone();
		let Some((root, inspect)) = self.screen.inspecting_mut() else {
			return;
		};
		let Some(search) = &mut inspect.find.search else {
			return;
		};
		let (root, scope, query) = (root.to_string(), search.scope.clone(), search.query.clone());
		let wait = settle && matches!(query, Query::Name(_));
		search.looking = Some(cx.spawn(async move |this, cx| {
			if wait {
				cx.background_executor()
					.timer(Duration::from_millis(180))
					.await;
			}
			let found = cx
				.background_executor()
				.spawn(async move { scans.find(&root, &scope, &query) })
				.await;
			// It's still the query: one that isn't has dropped this.
			this.update(cx, |this, cx| {
				if let Some((_, inspect)) = this.screen.inspecting_mut()
					&& let Some(search) = &mut inspect.find.search
				{
					search.found = found.map(Arc::new);
					search.looking = None;
					cx.notify();
				}
			})
			.ok();
		}));
		cx.notify();
	}

	/// Counts how much each finder finds below the folder find looks in,
	/// for the suggestions.
	pub fn load_summaries(&mut self, cx: &mut Context<Self>) {
		let scans = self.scans.clone();
		let Some((root, inspect)) = self.screen.inspecting_mut() else {
			return;
		};
		let scope = inspect.find.scope(&inspect.tree.cursor);
		let revision = inspect.revision;
		let counted =
			inspect.find.summaries.as_ref().is_some_and(|summaries| {
				summaries.scope == scope && summaries.revision == revision
			});
		if counted {
			return;
		}
		let (root, below) = (root.to_string(), scope.clone());
		inspect.find.summaries = Some(Summaries {
			scope,
			revision,
			sizes: None,
			_counting: cx.spawn(async move |this, cx| {
				let sizes = cx
					.background_executor()
					.spawn(async move { scans.summarize(&root, &below) })
					.await;
				// They're still the ones wanted: others would have dropped
				// this.
				this.update(cx, |this, cx| {
					if let Some((_, inspect)) = this.screen.inspecting_mut()
						&& let Some(summaries) = &mut inspect.find.summaries
					{
						summaries.sizes = sizes.map(Arc::new);
						cx.notify();
					}
				})
				.ok();
			}),
		});
	}

	pub fn move_suggestion(&mut self, by: i32, cx: &mut Context<Self>) {
		let Some((_, inspect)) = self.screen.inspecting_mut() else {
			return;
		};
		let count = inspect.find.suggestions(cx).len() as i32;
		if let Field::Suggesting { picked } = &mut inspect.find.field
			&& count > 0
		{
			*picked = (*picked as i32 + by).rem_euclid(count) as usize;
			cx.notify();
		}
	}

	/// Enter in the field: looks for the suggestion the arrows are on.
	pub fn pick_suggested(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if let Some((_, inspect)) = self.screen.inspecting()
			&& let Field::Suggesting { picked } = inspect.find.field
		{
			self.pick_suggestion(picked, window, cx);
		}
	}

	fn pick_suggestion(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
		let Some((_, inspect)) = self.screen.inspecting() else {
			return;
		};
		match inspect.find.suggestions(cx).get(index) {
			Some(Suggestion::Finder(finder)) => self.pick_finder(*finder, window, cx),
			// What's typed is already being looked for: this just puts the
			// suggestions away.
			_ => window.focus(&self.focus),
		}
	}

	/// What the toolbar has for the list: find, and how it's sorted. Find is
	/// a button until it's wanted. Then it's the field, there in the toolbar,
	/// with what it suggests under it while it has the focus; it's a button
	/// again once it's left with nothing in it.
	pub fn render_find_tools(&self, inspect: &Inspect, cx: &mut Context<Self>) -> AnyElement {
		let p = self.palette;
		let find = &inspect.find;
		let fill = p.fill;
		// Outlined, and as tall as the field one of them turns into.
		let tool = |id: &'static str, name: &'static str, says: &'static str| {
			div()
				.id(id)
				.flex()
				.flex_none()
				.items_center()
				.justify_center()
				.size(px(28.))
				.rounded(px(7.))
				.border_1()
				.border_color(p.line)
				.cursor_pointer()
				.hover(move |style| style.bg(fill))
				.child(icon(name, 15., p.muted))
				.tooltip(tip(says))
		};
		let scope_name = inspect.scope_name();
		let finder = find.finder();
		find.input.update(cx, |input, _| {
			input.placeholder = if finder.is_some() {
				"".into()
			} else {
				format!("Find in {scope_name}…").into()
			};
		});
		let input_focus = find.input.focus_handle(cx);

		let finder_chip = finder.map(|finder| {
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

		let suggesting = match find.field {
			Field::Suggesting { picked } => Some(picked),
			Field::Resting | Field::Wanted => None,
		};
		let field = div()
			.id("find-field")
			.flex()
			.items_center()
			.gap(px(8.))
			.w(px(FIND_WIDTH))
			.h(px(28.))
			.px(px(8.))
			.rounded(px(7.))
			.border_1()
			.border_color(if suggesting.is_some() {
				p.muted
			} else {
				p.line
			})
			.child(icon("search", 14., p.muted))
			.children(finder_chip)
			.child(div().flex_1().min_w_0().child(find.input.clone()))
			.when(find.search.is_some(), |this| {
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

		// What a query finds is in the order find has it.
		let sort = find.search.is_none().then(|| {
			let sorted = inspect.sort;
			self.opens_menu(
				tool("sort", "list-filter", "Sort"),
				MenuButton::Sort,
				Corner::TopRight,
				|| {
					SortMode::ALL
						.into_iter()
						.map(|mode| {
							PopupItem::action(mode.label(), move |this, _, _| {
								if let Some((_, inspect)) = this.screen.inspecting_mut() {
									inspect.sort = mode;
									inspect.show_all = false;
								}
							})
							.checked(sorted == mode)
						})
						.collect()
				},
				cx,
			)
		});

		let tools = div().flex().flex_none().items_center().gap(px(6.));
		let tools = match suggesting {
			// The field and what it suggests are drawn over what's behind
			// them while they're up (`render_find_backdrop`), as one thing: a
			// press on either is still theirs.
			Some(picked) => tools.child(
				deferred(
					div()
						.relative()
						.flex_none()
						.child(field)
						.child(self.render_suggestions(find, picked, &scope_name, cx)),
				)
				.with_priority(1),
			),
			None if find.showing() => tools.child(div().flex_none().child(field)),
			None => tools.child(
				tool("find", "search", "Find")
					.on_click(cx.listener(|this, _, window, cx| this.open_find(window, cx))),
			),
		};
		tools.children(sort).into_any_element()
	}

	fn render_suggestions(
		&self,
		find: &Find,
		picked: usize,
		scope_name: &str,
		cx: &mut Context<Self>,
	) -> AnyElement {
		let p = self.palette;
		let sizes = find
			.summaries
			.as_ref()
			.and_then(|summaries| summaries.sizes.as_ref());
		let rows = find
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
						let found = sizes.map(|sizes| {
							match sizes.iter().find(|summary| summary.finder == *finder) {
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
					.when(index == picked, |this| this.bg(p.fill))
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
		// Under the field, wider than it, with their right edges in line:
		// the field's at the toolbar's end.
		div()
			.absolute()
			.top(px(32.))
			.right_0()
			.w(px(SUGGESTIONS_WIDTH))
			.occlude()
			.p(px(4.))
			.rounded(px(8.))
			.bg(p.background)
			.border_1()
			.border_color(p.line)
			.shadow_lg()
			.children(rows)
			.into_any_element()
	}

	/// What's behind the find field while it's suggesting, and in front of
	/// everything else, as a menu has (`render_menu_backdrop`): nothing seen,
	/// but nothing under it lights up, and a press on it only puts the
	/// suggestions away. It isn't also a press on whatever it landed on.
	pub fn render_find_backdrop(
		&self,
		inspect: &Inspect,
		cx: &mut Context<Self>,
	) -> Option<AnyElement> {
		let Field::Suggesting { .. } = inspect.find.field else {
			return None;
		};
		Some(
			deferred(
				div()
					.absolute()
					.inset_0()
					.occlude()
					.on_any_mouse_down(cx.listener(|this, _, window, cx| {
						// The field losing the focus would shut them too, but
						// only once something else draws the window again.
						if let Some((_, inspect)) = this.screen.inspecting_mut() {
							inspect.find.field = Field::Resting;
						}
						window.focus(&this.focus);
						cx.notify();
						cx.stop_propagation();
					})),
			)
			.with_priority(0)
			.into_any_element(),
		)
	}
}
