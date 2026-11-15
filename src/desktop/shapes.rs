// Outlines for what's painted rather than laid out: circles and arcs, as
// the polygons gpui fills.

use gpui::{Path, PathBuilder, Pixels, Point, point, px};
use std::f32::consts::TAU;

/// The filled path with these closed outlines. Where they overlap an even
/// number of times is left empty, so a second outline inside the first is a
/// hole in it. None if there's nothing to fill.
pub fn filled(outlines: &[Vec<Point<Pixels>>]) -> Option<Path<Pixels>> {
	let mut builder = PathBuilder::fill();
	let mut any = false;
	for outline in outlines.iter().filter(|outline| outline.len() >= 3) {
		builder.move_to(outline[0]);
		for point in &outline[1..] {
			builder.line_to(*point);
		}
		builder.close();
		any = true;
	}
	if !any {
		return None;
	}
	builder.build().ok()
}

// How many straight edges stand in for an arc of `turns` at `radius`: enough
// that none strays a quarter pixel from the curve.
fn edges(radius: f32, turns: f32) -> usize {
	let step = (1.0 - 0.25 / radius.max(1.0)).clamp(-1.0, 1.0).acos() * 2.0;
	((turns * TAU / step.max(0.01)).ceil() as usize).max(2)
}

// The point `turns` clockwise from twelve o'clock, `radius` from `center`.
fn at(center: Point<Pixels>, radius: f32, turns: f32) -> Point<Pixels> {
	let angle = turns * TAU;
	point(
		center.x + px(radius * angle.sin()),
		center.y - px(radius * angle.cos()),
	)
}

pub fn circle(center: Point<Pixels>, radius: f32) -> Vec<Point<Pixels>> {
	let count = edges(radius, 1.0);
	(0..count)
		.map(|i| at(center, radius, i as f32 / count as f32))
		.collect()
}

/// The band between two radii, from `from` to `to` (in turns, clockwise
/// from twelve o'clock).
pub fn band(
	center: Point<Pixels>,
	inner: f32,
	outer: f32,
	from: f32,
	to: f32,
) -> Vec<Point<Pixels>> {
	let count = edges(outer, to - from);
	let along =
		|radius: f32, i: usize| at(center, radius, from + (to - from) * i as f32 / count as f32);
	(0..=count)
		.map(|i| along(outer, i))
		.chain((0..=count).rev().map(|i| along(inner, i)))
		.collect()
}

/// A whole ring between two radii.
pub fn ring(center: Point<Pixels>, inner: f32, outer: f32) -> Vec<Vec<Point<Pixels>>> {
	vec![circle(center, outer), circle(center, inner)]
}
