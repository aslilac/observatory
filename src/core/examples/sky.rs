// Writes a frame of the About window's sky as a BMP, to look at without
// opening the window:
//
//     cargo run --release -p observatory-core --example sky -- sky.bmp [turns]

use observatory_core::sky::{Ellipse, Order, Sky};
use std::time::Instant;

fn main() {
	let mut args = std::env::args().skip(1);
	let Some(file) = args.next() else {
		eprintln!("usage: sky <file.bmp> [turns]");
		std::process::exit(2);
	};
	let turns: f32 = args
		.next()
		.and_then(|turns| turns.parse().ok())
		.unwrap_or(0.0);

	// The window's size, twice over as on a Retina display, with the words
	// about where they are.
	let words = Ellipse {
		x: 210.0,
		y: 160.0,
		rx: 335.0,
		ry: 185.0,
	};
	let start = Instant::now();
	let sky = Sky::new(480.0, 600.0, 2.0, Some(words));
	let made = start.elapsed();
	// A BMP's colors go blue first.
	let picture = sky.frame(turns, Order::Bgra);
	eprintln!("made in {made:?}, a frame in {:?}", start.elapsed() - made);

	let (width, height) = sky.size();
	let mut bmp = Vec::with_capacity(54 + picture.len());
	bmp.extend(b"BM");
	bmp.extend((54 + picture.len() as u32).to_le_bytes());
	bmp.extend([0; 4]);
	bmp.extend(54u32.to_le_bytes());
	bmp.extend(40u32.to_le_bytes());
	bmp.extend((width as i32).to_le_bytes());
	// A negative height: the rows run from the top.
	bmp.extend((-(height as i32)).to_le_bytes());
	bmp.extend(1u16.to_le_bytes());
	bmp.extend(32u16.to_le_bytes());
	bmp.extend([0; 24]);
	bmp.extend(picture);
	std::fs::write(&file, bmp).expect("the file couldn't be written");
}
