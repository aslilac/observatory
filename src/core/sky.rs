// The About window's sky: the site's sunset behind the render of the
// observatory, under star trails turning around the pole (the point the
// telescope is aimed at). Around the pole the stars are only in three bands,
// and their trails take the colors of the sunburst on the telescope's
// mirror, by where they sit around it, so the sky draws the chart. A clear
// ring of sky sets it apart from the other stars.
//
// It's worked out a pixel at a time, into a plain RGBA picture, so whatever
// can show a picture can show it. The Electron app's is the same sky drawn
// by a browser (`views/about/about.css` and `sky.ts`, which this follows
// number for number, down to the random stars).

use serde::Deserialize;
use std::f32::consts::{PI, TAU};

// Where the horizon, the sun and the pole fall on the render, as fractions
// of the crop, written by `site/scene/about.py` beside the crop itself.
#[derive(Deserialize)]
struct Scene {
	// The crop's width over its height.
	aspect: f32,
	// The whole render's size, in crops. The sky is sized by it, as on the
	// site.
	render: [f32; 2],
	horizon: f32,
	sun: [f32; 2],
	pole: [f32; 2],
}

fn scene() -> Scene {
	serde_json::from_str(include_str!("../../build-resources/about/scene.json"))
		.expect("scene.json says where things are on the render")
}

/// How tall the render of the observatory is, across the bottom of a window
/// `width` wide.
pub fn scene_height(width: f32) -> f32 {
	width / scene().aspect
}

const TRAIL: f32 = TAU / 7.0; // how far around the pole a trail reaches
const DENSITY: f32 = 1.0 / 1200.0; // stars per square pixel

// The mirror's sunburst: each top-level folder's hue, and its share of the
// circle, starting at the top and going clockwise, as on the icon. The bands
// are the chart's rings, as fractions of its radius.
const SECTORS: [(u32, f32); 6] = [
	(0x5c9bff, 0.3),
	(0xa585ff, 0.21),
	(0xff7db6, 0.18),
	(0xff9366, 0.16),
	(0xffcf4d, 0.11),
	(0x9aa3b5, 0.04),
];
const BANDS: [(f32, f32); 3] = [(0.2, 0.42), (0.48, 0.69), (0.75, 0.95)];
// The clear ring around the chart, out to here (as a fraction of its radius).
const CLEAR: f32 = 1.18;
// How big the chart in the sky is, for the render: as on the site.
const CHART: f32 = 0.62;

type Rgb = [f32; 3];

fn hex(rgb: u32) -> Rgb {
	[
		(rgb >> 16 & 0xff) as f32 / 255.0,
		(rgb >> 8 & 0xff) as f32 / 255.0,
		(rgb & 0xff) as f32 / 255.0,
	]
}

fn mix(a: Rgb, b: Rgb, t: f32) -> Rgb {
	[
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	]
}

// The same sky every time the window opens, and the same as the Electron
// app's: its generator (mulberry32) and its seed.
struct Random(u32);

impl Random {
	fn next(&mut self) -> f32 {
		self.0 = self.0.wrapping_add(0x6d2b79f5);
		let seed = self.0;
		let mut t = (seed ^ (seed >> 15)).wrapping_mul(1 | seed);
		t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
		((t ^ (t >> 14)) as f64 / 4294967296.0) as f32
	}
}

fn sector_color(theta: f32) -> Rgb {
	// clockwise from the top, in screen terms (y down)
	let mut f = ((theta + PI / 2.0) / TAU).rem_euclid(1.0);
	for (color, share) in SECTORS {
		if f < share {
			return hex(color);
		}
		f -= share;
	}
	hex(SECTORS[0].0)
}

struct Star {
	// Where it is around the pole, before the sky's turned at all.
	r: f32,
	theta: f32,
	size: f32,
	alpha: f32,
	color: Rgb,
	trail_color: Rgb,
	trail_alpha: f32,
	trail_width: f32,
}

// The stars for a sky that reaches `reach` px from the pole, with the chart
// `chart` px across from it.
fn stars(reach: f32, chart: f32) -> Vec<Star> {
	let mut random = Random(7);
	let count = (PI * reach * reach * DENSITY).round() as usize;
	let mut stars = Vec::new();
	for _ in 0..count {
		let r = reach * random.next().sqrt();
		let theta = random.next() * TAU;
		let m = random.next().powi(3); // most stars are faint
		let kind = random.next();
		let tint = hex(if kind < 0.6 {
			0xfff8e8
		} else if kind < 0.85 {
			0xd8e4ff
		} else {
			0xffdcb8
		});
		// In the chart, only the bands have stars, and their trails take the
		// sunburst's colors, bolder than the rest so the rings read. Then
		// the clear ring, and then the rest of the sky.
		let colored = BANDS.iter().any(|(a, b)| r > a * chart && r < b * chart);
		if !colored && r < CLEAR * chart {
			continue;
		}
		stars.push(Star {
			r,
			theta,
			size: 0.45 + 1.3 * m,
			alpha: 0.35 + 0.65 * m,
			color: tint,
			trail_color: if colored { sector_color(theta) } else { tint },
			trail_alpha: if colored {
				0.55 + 0.45 * m
			} else {
				0.3 * (0.35 + 0.65 * m)
			},
			trail_width: if colored {
				1.1 + 0.9 * m
			} else {
				0.4 + 1.1 * m
			},
		});
	}
	stars
}

// One of the sunset's glows: an ellipse around the sun, `radii` of the
// render across, from one color at the middle through another `at` of the
// way out, to nothing at its edge.
struct Glow {
	radii: (f32, f32),
	from: (Rgb, f32),
	to: (Rgb, f32),
	at: f32,
}

// Back to front: the afterglow, wide and pink, up into the sky; the sun's
// glow, spreading along the horizon; and the sun, behind the building.
fn glows() -> [Glow; 3] {
	let rgb = |r: u8, g: u8, b: u8| [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
	[
		Glow {
			radii: (1.05, 0.6),
			from: (rgb(206, 108, 160), 0.42),
			to: (rgb(150, 84, 160), 0.15),
			at: 0.55,
		},
		Glow {
			radii: (0.46, 0.24),
			from: (rgb(255, 168, 122), 0.8),
			to: (rgb(246, 132, 128), 0.35),
			at: 0.5,
		},
		Glow {
			radii: (0.14, 0.07),
			from: (rgb(255, 232, 186), 0.95),
			to: (rgb(255, 194, 140), 0.5),
			at: 0.45,
		},
	]
}

// Zenith to horizon, away from the sun, then the haze below the horizon
// where the far clouds fade into it: each color, and how far above the
// horizon it sits, in renders.
const ZENITH: [(u32, f32); 8] = [
	(0x0d1033, 1.0),
	(0x191c56, 0.55),
	(0x2c2775, 0.34),
	(0x4d3c8f, 0.2),
	(0x7b5499, 0.1),
	(0xa8689a, 0.04),
	(0xc97f95, 0.0),
	(0xb47b9a, -0.05),
];
const GROUND: u32 = 0x7b6496;

/// Where the stars dim, so their trails don't run through the words.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ellipse {
	pub x: f32,
	pub y: f32,
	pub rx: f32,
	pub ry: f32,
}

/// Which way round a picture's colors go, for whoever's showing it. Either
/// way a fourth byte follows, always 255: the sky has nothing behind it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Order {
	Rgba,
	Bgra,
}

/// The sky for a window of one size, with everything about it that doesn't
/// turn worked out ahead, so a frame is only the stars.
pub struct Sky {
	// In the picture's own pixels.
	width: usize,
	height: usize,
	scale: f32,
	// The sunset, a color per pixel.
	background: Vec<[u8; 3]>,
	// For each pixel above the horizon: how much of the stars shows there
	// (they set into the haze, and dim behind the words), and where it is
	// around the pole.
	shows: Vec<f32>,
	radius: Vec<f32>,
	angle: Vec<f32>,
	stars: Vec<Star>,
	// Which stars' trails pass through each ring of pixels around the pole,
	// one ring per pixel of radius.
	rings: Vec<Vec<u32>>,
}

impl Sky {
	/// The sky for a window `width` by `height`, drawn `scale` pixels to
	/// each of its own (2 on a Retina display).
	pub fn new(width: f32, height: f32, scale: f32, words: Option<Ellipse>) -> Self {
		let scene = scene();
		let scene_height = width / scene.aspect;
		let scene_top = height - scene_height;
		let at = |[x, y]: [f32; 2]| (x * width, scene_top + y * scene_height);
		let sun = at(scene.sun);
		let pole = at(scene.pole);
		let horizon = scene_top + scene.horizon * scene_height;
		let render = (scene.render[0] * width, scene.render[1] * scene_height);

		let columns = (width * scale).ceil() as usize;
		let rows = (height * scale).ceil() as usize;
		// The middle of each pixel, in the window's terms.
		let middle = |index: usize| (index as f32 + 0.5) / scale;

		let glows = glows();
		// The colors down the sky, each with how far down the window it is.
		let mut stops: Vec<(f32, Rgb)> = ZENITH
			.iter()
			.map(|(color, above)| (horizon - above * render.1, hex(*color)))
			.collect();
		stops.push((height.max(stops[stops.len() - 1].0), hex(GROUND)));
		let mut background = Vec::with_capacity(columns * rows);
		for row in 0..rows {
			let y = middle(row);
			let sky = match stops.iter().position(|(at, _)| y < *at) {
				Some(0) => stops[0].1,
				Some(next) => {
					let (from, to) = (stops[next - 1], stops[next]);
					mix(from.1, to.1, (y - from.0) / (to.0 - from.0))
				}
				None => stops[stops.len() - 1].1,
			};
			for column in 0..columns {
				let x = middle(column);
				let mut color = sky;
				for glow in &glows {
					let out = ((x - sun.0) / (glow.radii.0 * render.0))
						.hypot((y - sun.1) / (glow.radii.1 * render.1));
					if out >= 1.0 {
						continue;
					}
					// As a browser fades a gradient to transparent: the
					// color holds, and only how much of it there is goes.
					let (tint, alpha) = if out < glow.at {
						let t = out / glow.at;
						let alpha = glow.from.1 + (glow.to.1 - glow.from.1) * t;
						let weighted = mix(
							glow.from.0.map(|c| c * glow.from.1),
							glow.to.0.map(|c| c * glow.to.1),
							t,
						);
						(weighted.map(|c| c / alpha), alpha)
					} else {
						(glow.to.0, glow.to.1 * (1.0 - out) / (1.0 - glow.at))
					};
					color = mix(color, tint, alpha);
				}
				background.push(color.map(|c| (c * 255.0).round().clamp(0.0, 255.0) as u8));
			}
		}

		// The stars are only above the horizon, which they fade out toward.
		let starry = ((horizon * scale).ceil() as usize).min(rows);
		let fade_from = horizon - 0.14 * render.1;
		let mut shows = Vec::with_capacity(columns * starry);
		let mut radius = Vec::with_capacity(columns * starry);
		let mut angle = Vec::with_capacity(columns * starry);
		for row in 0..starry {
			let y = middle(row);
			let setting = ((horizon - y) / (horizon - fade_from)).clamp(0.0, 1.0);
			for column in 0..columns {
				let x = middle(column);
				let behind_words = words.map_or(1.0, |words| {
					let out = ((x - words.x) / words.rx).hypot((y - words.y) / words.ry);
					(0.12 + (out - 0.5) / 0.5 * 0.88).clamp(0.12, 1.0)
				});
				shows.push(setting * behind_words);
				radius.push((x - pole.0).hypot(y - pole.1));
				angle.push((y - pole.1).atan2(x - pole.0).rem_euclid(TAU));
			}
		}

		// The radius of sky that can ever be seen, as it turns.
		let reach = [(0.0, 0.0), (width, 0.0), (0.0, horizon), (width, horizon)]
			.into_iter()
			.map(|(x, y): (f32, f32)| (x - pole.0).hypot(y - pole.1))
			.fold(0.0, f32::max);
		let stars = stars(reach, CHART * render.1);
		let mut rings = vec![Vec::new(); (reach * scale).ceil() as usize + 2];
		for (index, star) in stars.iter().enumerate() {
			// A pixel either side, for the soft edge.
			let half = star.trail_width.max(star.size) / 2.0 + 1.0 / scale;
			let inner = ((star.r - half) * scale).floor().max(0.0) as usize;
			let outer = (((star.r + half) * scale).ceil() as usize).min(rings.len() - 1);
			for ring in &mut rings[inner..=outer] {
				ring.push(index as u32);
			}
		}

		Self {
			width: columns,
			height: rows,
			scale,
			background,
			shows,
			radius,
			angle,
			stars,
			rings,
		}
	}

	/// The picture's size, in its own pixels.
	pub fn size(&self) -> (usize, usize) {
		(self.width, self.height)
	}

	/// The sky once it's gone `turns` of the way around, four bytes a pixel
	/// in `order`, a row at a time from the top. It turns anticlockwise, as
	/// around the north pole.
	pub fn frame(&self, turns: f32, order: Order) -> Vec<u8> {
		let turned = turns.rem_euclid(1.0) * TAU;
		// Where each star has got to.
		let heads: Vec<f32> = self
			.stars
			.iter()
			.map(|star| (star.theta - turned).rem_euclid(TAU))
			.collect();
		let scale = self.scale;
		// How much of a pixel something `half` wide covers, `away` from its
		// middle. Something thinner than a pixel never covers all of one.
		let covers = |half: f32, away: f32| {
			((half - away) * scale + 0.5).clamp(0.0, (2.0 * half * scale).min(1.0))
		};

		let mut picture = Vec::with_capacity(self.background.len() * 4);
		for (index, background) in self.background.iter().enumerate() {
			let mut pixel = *background;
			let shows = self.shows.get(index).copied().unwrap_or(0.0);
			if shows > 0.002 {
				let (radius, angle) = (self.radius[index], self.angle[index]);
				let ring = ((radius * scale) as usize).min(self.rings.len() - 1);
				// What the stars add here, and how much of the sky they
				// cover. Where trails cross, they glow: their light adds up.
				let mut light = [0.0f32; 3];
				let mut cover = 0.0f32;
				for &star in &self.rings[ring] {
					let head = heads[star as usize];
					let star = &self.stars[star as usize];
					// How far back along the star's path this is. The trail
					// runs back clockwise, fainter toward its tail.
					let mut behind = angle - head;
					if behind < 0.0 {
						behind += TAU;
					}
					let off = (radius - star.r).abs();
					if behind < TRAIL {
						let covered = covers(star.trail_width / 2.0, off);
						if covered > 0.0 {
							let fade = (1.0 - behind / TRAIL).powf(1.6);
							let alpha = star.trail_alpha * fade * covered;
							for (sum, c) in light.iter_mut().zip(star.trail_color) {
								*sum += c * alpha;
							}
							cover += alpha;
						}
					}
					// The star itself, at the head of its trail.
					let along = star.r * if behind > PI { behind - TAU } else { behind };
					if off < star.size && along.abs() < star.size {
						let alpha = star.alpha * covers(star.size / 2.0, off.hypot(along));
						for (sum, c) in light.iter_mut().zip(star.color) {
							*sum += c * alpha;
						}
						cover += alpha;
					}
				}
				if cover > 0.0 {
					let cover = cover.min(1.0) * shows;
					for (c, light) in pixel.iter_mut().zip(light) {
						let lit = *c as f32 * (1.0 - cover) + light.min(1.0) * shows * 255.0;
						*c = lit.round().clamp(0.0, 255.0) as u8;
					}
				}
			}
			if order == Order::Bgra {
				pixel.swap(0, 2);
			}
			picture.extend(pixel);
			picture.push(255);
		}
		picture
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_stars_are_the_electron_apps() {
		// mulberry32 from seed 7, as `sky.ts` has it.
		let mut random = Random(7);
		let first = random.next();
		assert!((0.0..1.0).contains(&first));
		let again = Random(7).next();
		assert_eq!(first, again);
	}

	#[test]
	fn the_sky_is_dark_at_the_top_and_turns() {
		let sky = Sky::new(480.0, 600.0, 1.0, None);
		assert_eq!(sky.size(), (480, 600));
		let still = sky.frame(0.0, Order::Rgba);
		assert_eq!(still.len(), 480 * 600 * 4);
		// The top of the sky, where no star happens to be.
		assert_eq!(still[..4], [0x0d, 0x10, 0x33, 255]);
		assert_eq!(sky.frame(0.0, Order::Bgra)[..4], [0x33, 0x10, 0x0d, 255]);
		// The ground under the horizon has no stars: it's the same whichever
		// way the sky's turned.
		let turned = sky.frame(0.25, Order::Rgba);
		let last_row = 480 * 599 * 4;
		assert_eq!(still[last_row..], turned[last_row..]);
		assert_ne!(still, turned);
		// A whole turn brings it back.
		assert_eq!(still, sky.frame(1.0, Order::Rgba));
	}

	#[test]
	fn nothing_but_the_bands_is_in_the_chart() {
		let chart = 200.0;
		for star in stars(500.0, chart) {
			let banded = BANDS
				.iter()
				.any(|(a, b)| star.r > a * chart && star.r < b * chart);
			assert!(banded || star.r >= CLEAR * chart);
		}
	}
}
