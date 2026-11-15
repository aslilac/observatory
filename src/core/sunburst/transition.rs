// Moving from one folder to another, the sunburst zooms the way d3's
// zoomable sunburst does (observablehq.com/@d3/zoomable-sunburst): every
// wedge that's in both views slides from where it was to where it's going,
// the folder that was opened spreads around the circle while its siblings
// squeeze shut at the edge, and its parents sink into the center. Wedges
// only one view has fade, in from or out to where they'd be in the other.

use super::Sweep;
use super::geometry::{CENTER_RADIUS, covers, polar};
use super::layout::{Wedge, wedge_key};
use crate::color::Color;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

pub const DURATION: Duration = Duration::from_millis(750);

// Which folder a view is centered on, and how far around the circle its
// contents go (less than a whole turn at the root of a disk, where the rest
// is free space).
#[derive(Debug, Clone, PartialEq)]
pub struct View {
	pub root: String,
	pub cursor: Vec<String>,
	pub span: f64,
}

// How a point in the new view maps to the old one: angles scale and shift,
// layers only shift.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ViewMapping {
	pub scale: f64,
	pub offset: f64,
	pub shift: f64,
}

const IDENTITY: ViewMapping = ViewMapping {
	scale: 1.0,
	offset: 0.0,
	shift: 0.0,
};

// How the `next` view maps onto `prev`, through the folder one of them is
// centered on, which is a wedge in the other. None if they don't share one
// (a jump elsewhere in the scan, or that wedge was too small to draw), when
// the views just swap.
pub fn view_mapping(
	prev: &View,
	next: &View,
	prev_sweep: impl Fn(&str) -> Option<Sweep>,
	next_sweep: impl Fn(&str) -> Option<Sweep>,
) -> Option<ViewMapping> {
	if prev.root != next.root {
		return None;
	}
	let root = &next.root;
	if prev.cursor.len() == next.cursor.len() {
		return (prev.cursor == next.cursor).then_some(IDENTITY);
	}
	if next.cursor.starts_with(&prev.cursor) {
		// In: the new center was a wedge in the old view.
		let opened = prev_sweep(&wedge_key(root, &next.cursor))?;
		if !(next.span > 0.0) {
			return None;
		}
		return Some(ViewMapping {
			scale: (opened.x1 - opened.x0) / next.span,
			offset: opened.x0,
			shift: opened.layer + 1.0,
		});
	}
	if prev.cursor.starts_with(&next.cursor) {
		// Out: the old center is a wedge in the new view.
		let closed = next_sweep(&wedge_key(root, &prev.cursor))?;
		if !(prev.span > 0.0) || !(closed.x1 > closed.x0) {
			return None;
		}
		let scale = prev.span / (closed.x1 - closed.x0);
		return Some(ViewMapping {
			scale,
			offset: -closed.x0 * scale,
			shift: -(closed.layer + 1.0),
		});
	}
	None
}

// Angles are kept to the circle, so whatever falls outside it squeezes shut
// at the top-left edge, where the circle begins and ends.
fn clamp_turn(x: f64) -> f64 {
	x.clamp(0.0, 1.0)
}

pub fn to_old_view(sweep: Sweep, m: ViewMapping) -> Sweep {
	Sweep {
		x0: clamp_turn(sweep.x0 * m.scale + m.offset),
		x1: clamp_turn(sweep.x1 * m.scale + m.offset),
		layer: sweep.layer + m.shift,
	}
}

pub fn to_new_view(sweep: Sweep, m: ViewMapping) -> Sweep {
	Sweep {
		x0: clamp_turn((sweep.x0 - m.offset) / m.scale),
		x1: clamp_turn((sweep.x1 - m.offset) / m.scale),
		layer: sweep.layer - m.shift,
	}
}

// What's showing of a wedge.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pose {
	pub sweep: Sweep,
	pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Track {
	pub key: String,
	// A wedge that's no longer in the view, drawn while it fades away.
	pub ghost: bool,
	pub fill: Color,
	pub from: Pose,
	pub to: Pose,
}

// Where each wedge goes from and to, from what's showing (`shown`, which
// may be partway through another move) to `wedges`. The wedges' tracks come
// first, in their order, then the ghosts'.
pub fn plan_transition(
	shown: &HashMap<String, (Pose, Color)>,
	wedges: &[Wedge],
	mapping: ViewMapping,
) -> Vec<Track> {
	let mut tracks = Vec::with_capacity(wedges.len());
	let mut keys = HashSet::new();
	for wedge in wedges {
		keys.insert(wedge.key.as_str());
		let from = shown.get(&wedge.key).map_or(
			Pose {
				sweep: to_old_view(wedge.sweep, mapping),
				opacity: 0.0,
			},
			|(pose, _)| *pose,
		);
		tracks.push(Track {
			key: wedge.key.clone(),
			ghost: false,
			fill: wedge.fill,
			from,
			to: Pose {
				sweep: wedge.sweep,
				opacity: 1.0,
			},
		});
	}
	let mut ghosts: Vec<_> = shown
		.iter()
		.filter(|(key, _)| !keys.contains(key.as_str()))
		.map(|(key, (pose, fill))| Track {
			key: key.clone(),
			ghost: true,
			fill: *fill,
			from: *pose,
			to: Pose {
				sweep: to_new_view(pose.sweep, mapping),
				opacity: 0.0,
			},
		})
		.collect();
	// The map has no order of its own, and the same ghosts should overlap
	// the same way on every frame.
	ghosts.sort_by(|a, b| a.key.cmp(&b.key));
	tracks.extend(ghosts);
	tracks
}

fn ease_cubic_in_out(t: f64) -> f64 {
	if t < 0.5 {
		4.0 * t * t * t
	} else {
		1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
	}
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
	a + (b - a) * t
}

pub fn pose_partway(from: Pose, to: Pose, t: f64) -> Pose {
	Pose {
		sweep: Sweep {
			x0: lerp(from.sweep.x0, to.sweep.x0, t),
			x1: lerp(from.sweep.x1, to.sweep.x1, t),
			layer: lerp(from.sweep.layer, to.sweep.layer, t),
		},
		opacity: lerp(from.opacity, to.opacity, t),
	}
}

/// One wedge of a frame: where it is right now, and how much of it shows.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Drawn {
	pub sweep: Sweep,
	pub opacity: f64,
	pub fill: Color,
	/// Which of `Sunburst::wedges` it is. None for one that's fading away.
	pub wedge: Option<usize>,
}

/// What's under a point of the sunburst.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hit {
	/// The circle in the middle.
	Center,
	/// One of `Sunburst::wedges`.
	Wedge(usize),
}

struct Motion {
	tracks: Vec<Track>,
	start: Duration,
}

/// The sunburst as it's showing, moving from one view's wedges to the
/// next's. Whoever draws it tells it what to show (`show`), and asks for
/// each frame (`frame`) for as long as it's `animating`. Times are from
/// whatever clock the caller keeps, so long as it's the same one.
#[derive(Default)]
pub struct Sunburst {
	wedges: Vec<Wedge>,
	view: Option<View>,
	// What's showing of each wedge, as of the last frame.
	shown: HashMap<String, (Pose, Color)>,
	motion: Option<Motion>,
}

impl Sunburst {
	pub fn new() -> Self {
		Self::default()
	}

	/// The wedges of the view it's showing, or moving to.
	pub fn wedges(&self) -> &[Wedge] {
		&self.wedges
	}

	pub fn view(&self) -> Option<&View> {
		self.view.as_ref()
	}

	pub fn animating(&self) -> bool {
		self.motion.is_some()
	}

	/// Shows `wedges`, the `view`'s, moving to them from whatever's showing
	/// if the two views have a folder in common. `still` is for when things
	/// shouldn't move (the OS's reduce-motion setting).
	pub fn show(&mut self, view: View, wedges: Vec<Wedge>, now: Duration, still: bool) {
		// A move that's underway is picked up from where it's got to.
		if self.motion.is_some() {
			self.advance(now);
		}
		let mapping = self.view.as_ref().and_then(|prev| {
			view_mapping(
				prev,
				&view,
				|key| self.shown.get(key).map(|(pose, _)| pose.sweep),
				|key| wedges.iter().find(|w| w.key == key).map(|w| w.sweep),
			)
		});
		let tracks = mapping
			.filter(|_| !still)
			.map(|mapping| plan_transition(&self.shown, &wedges, mapping))
			.filter(|tracks| tracks.iter().any(|track| track.from != track.to));
		self.view = Some(view);
		self.wedges = wedges;
		match tracks {
			Some(tracks) => {
				self.motion = Some(Motion { tracks, start: now });
				self.advance(now);
			}
			None => self.settle(),
		}
	}

	fn settle(&mut self) {
		self.motion = None;
		self.shown = self
			.wedges
			.iter()
			.map(|wedge| {
				let pose = Pose {
					sweep: wedge.sweep,
					opacity: 1.0,
				};
				(wedge.key.clone(), (pose, wedge.fill))
			})
			.collect();
	}

	fn advance(&mut self, now: Duration) {
		let Some(motion) = &self.motion else {
			return;
		};
		let t = now.saturating_sub(motion.start).as_secs_f64() / DURATION.as_secs_f64();
		if t >= 1.0 {
			self.settle();
			return;
		}
		let t = ease_cubic_in_out(t);
		self.shown = motion
			.tracks
			.iter()
			.map(|track| {
				let pose = pose_partway(track.from, track.to, t);
				(track.key.clone(), (pose, track.fill))
			})
			.collect();
	}

	/// What to draw at `now`, back to front: the wedges that are fading
	/// away, then the view's own.
	pub fn frame(&mut self, now: Duration) -> Vec<Drawn> {
		self.advance(now);
		let ghosts = self.motion.iter().flat_map(|motion| {
			motion
				.tracks
				.iter()
				.filter(|track| track.ghost)
				.map(|track| {
					let (pose, fill) = self.shown[&track.key];
					Drawn {
						sweep: pose.sweep,
						opacity: pose.opacity,
						fill,
						wedge: None,
					}
				})
		});
		let wedges = self.wedges.iter().enumerate().map(|(index, wedge)| {
			let pose = self.shown.get(&wedge.key).map_or(
				Pose {
					sweep: wedge.sweep,
					opacity: 1.0,
				},
				|(pose, _)| *pose,
			);
			Drawn {
				sweep: pose.sweep,
				opacity: pose.opacity,
				fill: wedge.fill,
				wedge: Some(index),
			}
		});
		ghosts.chain(wedges).collect()
	}

	/// What's at a point, in the sunburst's units from its center. Wedges
	/// are where they're going, not where they've got to: what's clicked
	/// mid-move is what will be there.
	pub fn hit(&self, x: f64, y: f64) -> Option<Hit> {
		let (turns, radius) = polar(x, y);
		if radius <= CENTER_RADIUS {
			return Some(Hit::Center);
		}
		self.wedges
			.iter()
			.position(|wedge| covers(wedge.sweep, turns, radius))
			.map(Hit::Wedge)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::sunburst::layout::{LayoutInput, layout_wedges};
	use crate::tree::Node;
	use std::sync::Arc;

	fn view(cursor: &[&str], span: f64) -> View {
		View {
			root: "/disk".to_string(),
			cursor: cursor.iter().map(|s| s.to_string()).collect(),
			span,
		}
	}

	fn sweep(x0: f64, x1: f64, layer: f64) -> Sweep {
		Sweep { x0, x1, layer }
	}

	#[test]
	fn opening_a_folder_maps_through_its_wedge() {
		let opened = sweep(0.25, 0.75, 1.0);
		let m = view_mapping(
			&view(&[], 1.0),
			&view(&["a", "b"], 1.0),
			|key| (key == "/disk\0a\0b").then_some(opened),
			|_| None,
		)
		.unwrap();
		assert_eq!(
			m,
			ViewMapping {
				scale: 0.5,
				offset: 0.25,
				shift: 2.0
			}
		);
		// The new view's first ring is where the folder's children were.
		assert_eq!(to_old_view(sweep(0.0, 1.0, 0.0), m), sweep(0.25, 0.75, 2.0));
		// And the old view's wedges, from the new one: the folder itself fills
		// the center, and its siblings are squeezed shut at the edges.
		assert_eq!(to_new_view(opened, m), sweep(0.0, 1.0, -1.0));
		assert_eq!(to_new_view(sweep(0.0, 0.25, 1.0), m), sweep(0.0, 0.0, -1.0));
		assert_eq!(to_new_view(sweep(0.75, 1.0, 1.0), m), sweep(1.0, 1.0, -1.0));
	}

	#[test]
	fn going_up_is_the_same_backwards() {
		let closed = sweep(0.25, 0.75, 0.0);
		let m = view_mapping(
			&view(&["a"], 1.0),
			&view(&[], 1.0),
			|_| None,
			|key| (key == "/disk\0a").then_some(closed),
		)
		.unwrap();
		assert_eq!(
			m,
			ViewMapping {
				scale: 2.0,
				offset: -0.5,
				shift: -1.0
			}
		);
		assert_eq!(to_old_view(closed, m), sweep(0.0, 1.0, -1.0));
	}

	#[test]
	fn views_with_nothing_in_common_do_not_map() {
		let none = |_: &str| None;
		let some = |_: &str| Some(sweep(0.0, 0.5, 0.0));
		assert!(view_mapping(&view(&["a"], 1.0), &view(&["b"], 1.0), some, some).is_none());
		assert!(view_mapping(&view(&["a"], 1.0), &view(&["b", "c"], 1.0), some, some).is_none());
		// The folder's wedge was too small to have been drawn.
		assert!(view_mapping(&view(&[], 1.0), &view(&["a"], 1.0), none, none).is_none());
		let mut other = view(&[], 1.0);
		other.root = "/other".to_string();
		assert!(view_mapping(&view(&[], 1.0), &other, some, some).is_none());
		assert_eq!(
			view_mapping(&view(&["a"], 1.0), &view(&["a"], 1.0), none, none),
			Some(IDENTITY)
		);
	}

	fn disk() -> (Vec<Arc<Node>>, Vec<Arc<Node>>) {
		let inside = vec![
			Arc::new(Node::file("big", 40, 0)),
			Arc::new(Node::file("small", 20, 0)),
		];
		let files = vec![
			Arc::new(Node::directory("a", 60, 0, inside.clone())),
			Arc::new(Node::file("b", 40, 0)),
		];
		(files, inside)
	}

	fn wedges(files: &[Arc<Node>], cursor: &[String], size: u64) -> Vec<Wedge> {
		layout_wedges(&LayoutInput {
			root: "/disk",
			cursor,
			files,
			capacity: size,
			size,
			root_size: 100,
			position: 0.0,
			reserved: &[],
			dark: false,
		})
	}

	#[test]
	fn the_first_view_appears_at_once() {
		let (files, _) = disk();
		let mut sunburst = Sunburst::new();
		sunburst.show(
			view(&[], 1.0),
			wedges(&files, &[], 100),
			Duration::ZERO,
			false,
		);
		assert!(!sunburst.animating());
		let frame = sunburst.frame(Duration::ZERO);
		assert_eq!(frame.len(), 4);
		assert!(frame.iter().all(|drawn| drawn.opacity == 1.0));
	}

	#[test]
	fn opening_a_folder_moves_then_settles() {
		let (files, inside) = disk();
		let cursor = ["a".to_string()];
		let mut sunburst = Sunburst::new();
		sunburst.show(
			view(&[], 1.0),
			wedges(&files, &[], 100),
			Duration::ZERO,
			false,
		);
		let start = Duration::from_secs(1);
		sunburst.show(
			view(&["a"], 1.0),
			wedges(&inside, &cursor, 60),
			start,
			false,
		);
		assert!(sunburst.animating());

		// At the start everything's where it was: `big` in the second ring,
		// and `a` and `b`, which the new view doesn't have, still showing.
		let frame = sunburst.frame(start);
		let ghosts: Vec<_> = frame.iter().filter(|d| d.wedge.is_none()).collect();
		assert_eq!(ghosts.len(), 2);
		assert!(ghosts.iter().all(|ghost| ghost.opacity == 1.0));
		let big = frame.iter().find(|d| d.wedge == Some(0)).unwrap();
		assert_eq!(big.sweep, sweep(0.0, 0.4, 1.0));
		// Ghosts are drawn first, under the wedges.
		assert!(frame[0].wedge.is_none() && frame[1].wedge.is_none());

		// Halfway, it's halfway.
		let frame = sunburst.frame(start + DURATION / 2);
		let big = frame.iter().find(|d| d.wedge == Some(0)).unwrap();
		assert!((big.sweep.layer - 0.5).abs() < 1e-9);
		assert!(big.sweep.x1 > 0.4 && big.sweep.x1 < 40.0 / 60.0);
		assert!(
			frame
				.iter()
				.filter(|d| d.wedge.is_none())
				.all(|g| g.opacity < 1.0)
		);

		// And at the end only the new view is left.
		let frame = sunburst.frame(start + DURATION);
		assert!(!sunburst.animating());
		assert_eq!(frame.len(), 2);
		assert_eq!(frame[0].sweep, sweep(0.0, 40.0 / 60.0, 0.0));
	}

	#[test]
	fn nothing_moves_when_asked_to_keep_still() {
		let (files, inside) = disk();
		let cursor = ["a".to_string()];
		let mut sunburst = Sunburst::new();
		sunburst.show(
			view(&[], 1.0),
			wedges(&files, &[], 100),
			Duration::ZERO,
			false,
		);
		sunburst.show(
			view(&["a"], 1.0),
			wedges(&inside, &cursor, 60),
			Duration::ZERO,
			true,
		);
		assert!(!sunburst.animating());
		assert_eq!(sunburst.frame(Duration::ZERO).len(), 2);
	}

	#[test]
	fn points_hit_wedges() {
		let (files, _) = disk();
		let mut sunburst = Sunburst::new();
		sunburst.show(
			view(&[], 1.0),
			wedges(&files, &[], 100),
			Duration::ZERO,
			false,
		);
		assert_eq!(sunburst.hit(10.0, 10.0), Some(Hit::Center));
		// Straight up is an eighth of a turn round: in `a`, then `big` a ring
		// out, then nothing.
		assert_eq!(sunburst.hit(0.0, -80.0), Some(Hit::Wedge(0)));
		assert_eq!(sunburst.hit(0.0, -110.0), Some(Hit::Wedge(1)));
		assert_eq!(sunburst.hit(0.0, -140.0), None);
		// Straight down is five eighths round, in `b`.
		assert_eq!(sunburst.hit(0.0, 80.0), Some(Hit::Wedge(3)));
	}
}
