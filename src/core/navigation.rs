// Where the user is, and where they've been: a history like a browser's.

/// A place: a scan (`inspecting`, by its root's path; None for the list of
/// disks and folders) and a folder in it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Place {
	pub inspecting: Option<String>,
	pub cursor: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Navigation {
	history: Vec<Place>,
	index: usize,
}

impl Default for Navigation {
	fn default() -> Self {
		Self::starting_at(None)
	}
}

impl Navigation {
	/// A history that begins in the scan of `inspecting`, or at the list of
	/// disks and folders.
	pub fn starting_at(inspecting: Option<String>) -> Self {
		Self {
			history: vec![Place {
				inspecting,
				cursor: Vec::new(),
			}],
			index: 0,
		}
	}

	pub fn current(&self) -> &Place {
		&self.history[self.index]
	}

	pub fn can_back(&self) -> bool {
		self.index > 0
	}

	pub fn can_forward(&self) -> bool {
		self.index + 1 < self.history.len()
	}

	/// Goes somewhere new, which drops whatever there was to go forward to.
	/// Going where one already is does nothing. Says whether anything
	/// changed, as the rest do.
	pub fn navigate(&mut self, place: Place) -> bool {
		if *self.current() == place {
			return false;
		}
		self.history.truncate(self.index + 1);
		self.history.push(place);
		self.index += 1;
		true
	}

	pub fn back(&mut self) -> bool {
		let can = self.can_back();
		if can {
			self.index -= 1;
		}
		can
	}

	pub fn forward(&mut self) -> bool {
		let can = self.can_forward();
		if can {
			self.index += 1;
		}
		can
	}

	/// To the root of a scan, or to the list of disks and folders.
	pub fn inspect(&mut self, path: Option<String>) -> bool {
		self.navigate(Place {
			inspecting: path,
			cursor: Vec::new(),
		})
	}

	/// To another folder of the scan that's showing.
	pub fn set_cursor(&mut self, cursor: Vec<String>) -> bool {
		let inspecting = self.current().inspecting.clone();
		self.navigate(Place { inspecting, cursor })
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn goes_back_and_forward_and_drops_the_rest() {
		let mut nav = Navigation::default();
		assert!(!nav.can_back() && !nav.can_forward());
		assert!(nav.inspect(Some("/a".into())));
		assert!(nav.set_cursor(vec!["x".into()]));
		assert!(!nav.set_cursor(vec!["x".into()]));
		assert!(nav.back());
		assert_eq!(nav.current().cursor, Vec::<String>::new());
		assert!(nav.can_forward());
		assert!(nav.set_cursor(vec!["y".into()]));
		assert!(!nav.can_forward());
		assert!(nav.back() && nav.back());
		assert_eq!(nav.current().inspecting, None);
		assert!(!nav.back());
	}
}
