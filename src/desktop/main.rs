use gpui::{prelude::*, *};

struct Hello;

impl Render for Hello {
	fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
		div().size_full().bg(rgb(0xf9f9fd)).child("Observatory")
	}
}

fn main() {
	Application::new().run(|cx: &mut App| {
		cx.open_window(WindowOptions::default(), |_, cx| cx.new(|_| Hello))
			.unwrap();
	});
}
