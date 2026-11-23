// New versions, as the window has them: a button in the title bar that says
// one is out, or on macOS, once it's been downloaded and checked, that
// restarting will put it in place. On Windows, for a copy installed as a
// package by hand, a press on it downloads the new package and hands it to
// Windows. Finding and fetching them is `observatory_core::updates`'s.

use crate::controls::{ButtonKind, button, icon};
use crate::workspace::Workspace;
use gpui::{AnyElement, Context, Window, prelude::*, px};
use observatory_core::system::describe_installation;
use observatory_core::updates::{self, Release};
use std::time::Duration;

// How often it looks.
const EVERY: Duration = Duration::from_secs(60 * 60);

pub enum Update {
	/// There's a newer version, to go and get.
	Available(Release),
	/// Its package is being downloaded, to hand to Windows.
	Fetching(Release),
	/// It's here, checked, and takes the app's place on a restart.
	#[cfg(target_os = "macos")]
	Ready(updates::Staged, Release),
}

impl Update {
	fn version(&self) -> &str {
		match self {
			Self::Available(release) | Self::Fetching(release) => &release.version,
			#[cfg(target_os = "macos")]
			Self::Ready(_, release) => &release.version,
		}
	}
}

// Whether this copy looks for new versions at all. The Store and Flatpak
// bring their own, when they get to it, and a build that's being worked on
// has nothing to update to, unless it's been pointed at a feed to try.
fn looks_for_updates() -> bool {
	std::env::var_os("OBSERVATORY_UPDATE_FEED").is_some()
		|| matches!(
			describe_installation(cfg!(debug_assertions)),
			"App" | "Portable" | "MSIX"
		)
}

// Whether this copy is a package Windows will take a newer one of: one
// installed by hand, not the Store's.
fn takes_packages() -> bool {
	cfg!(windows) && describe_installation(cfg!(debug_assertions)) == "MSIX"
}

// Looks for a newer release than this copy, and where the app can install
// it itself, gets it ready. Takes as long as the network does.
fn look() -> Option<Update> {
	let release = updates::check(env!("CARGO_PKG_VERSION"), updates::fetch)?;
	#[cfg(target_os = "macos")]
	if release.download.is_some()
		&& let Some(installed) = updates::installed()
	{
		// If it can't be got ready (the download failed, or wasn't what it
		// should be), there's still a new version to say is out.
		if let Ok(staged) = updates::stage(&release, &installed) {
			return Some(Update::Ready(staged, release));
		}
	}
	Some(Update::Available(release))
}

impl Workspace {
	/// Looks for a new version now, and every hour after.
	pub fn watch_for_updates(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if !looks_for_updates() {
			return;
		}
		cx.spawn_in(window, async move |this, cx| {
			loop {
				let found = cx.background_executor().spawn(async { look() }).await;
				let alive = this.update(cx, |this, cx| {
					// One that's already downloaded isn't traded for the
					// news that it's out.
					let newer = match (&this.update, &found) {
						(Some(have), Some(found)) => have.version() != found.version(),
						(None, Some(_)) => true,
						(_, None) => false,
					};
					if newer {
						this.update = found;
						cx.notify();
					}
				});
				if alive.is_err() {
					break;
				}
				cx.background_executor().timer(EVERY).await;
			}
		})
		.detach();
	}

	// Downloads the new version's package and opens it, which brings up
	// Windows' installer to ask about updating. If it can't be had, the
	// release's page is still somewhere to get it.
	fn fetch_package(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		let Some(Update::Available(release)) = &self.update else {
			return;
		};
		let release = release.clone();
		let fetched = release.clone();
		self.update = Some(Update::Fetching(release.clone()));
		cx.notify();
		cx.spawn_in(window, async move |this, cx| {
			let opened = cx
				.background_executor()
				.spawn(async move {
					updates::stage_package(&fetched).and_then(|msix| updates::open_package(&msix))
				})
				.await;
			let _ = this.update(cx, |this, cx| {
				if opened.is_err() {
					cx.open_url(&release.page);
				}
				// Unless one newer still has turned up meanwhile.
				if let Some(Update::Fetching(_)) = this.update {
					this.update = Some(Update::Available(release));
				}
				cx.notify();
			});
		})
		.detach();
	}

	pub fn render_update_button(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
		let p = self.palette;
		let update = self.update.as_ref()?;
		let button = match update {
			Update::Available(release) | Update::Fetching(release) => {
				let page = release.page.clone();
				// A package can be fetched for Windows to install; anything
				// else is got from the release's page.
				let package = takes_packages() && release.download.is_some();
				let says = match update {
					Update::Fetching(_) => format!("Downloading {}…", release.version),
					_ => format!("Version {} is out", release.version),
				};
				button("update", says, ButtonKind::Default, true, &p)
					.gap(px(4.))
					.when(!package, |this| {
						this.child(icon("arrow-up-right", 12., p.muted))
					})
					.on_click(cx.listener(move |this, _, window, cx| {
						cx.stop_propagation();
						if package {
							this.fetch_package(window, cx);
						} else {
							cx.open_url(&page);
						}
					}))
			}
			#[cfg(target_os = "macos")]
			Update::Ready(..) => {
				button("update", "Restart to update", ButtonKind::Primary, true, &p).on_click(
					cx.listener(|this, _, _, cx| {
						cx.stop_propagation();
						let Some(Update::Ready(staged, release)) = this.update.take() else {
							return;
						};
						match updates::relaunch(&staged) {
							Ok(()) => cx.quit(),
							// It couldn't be put in place: it's still out, to
							// get by hand.
							Err(_) => {
								this.update = Some(Update::Available(release));
								cx.notify();
							}
						}
					}),
				)
			}
		};
		// In the title bar, which the window's moved by: a press here is the
		// button's.
		Some(button.occlude().mr(px(4.)).into_any_element())
	}
}
