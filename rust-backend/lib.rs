use async_recursion::async_recursion;
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::convert::Infallible;
use std::fmt::Debug;
use std::io;
use std::path::Path;
use tokio::fs;
use tokio_stream::StreamExt;
// use std::sync::mpsc::channel;
pub enum VfsNode {
	Directory {
		name: String,
		size: u64,
		capacity: Option<u64>,
		contents: BTreeSet<VfsNode>,
	},
	File {
		name: String,
		size: u64,
	},
	Error(io::Error),
}

// Custom implementation that doesn't print `contents` for `Directory` so that you
// get some output which is actually readable.
impl Debug for VfsNode {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			VfsNode::Directory {
				name,
				size,
				capacity,
				..
			} => f
				.debug_struct("Directory")
				.field("name", name)
				.field("size", size)
				.field("capacity", capacity)
				.finish(),
			VfsNode::File { name, size } => f
				.debug_struct("File")
				.field("name", name)
				.field("size", size)
				.finish(),
			VfsNode::Error(err) => f.debug_tuple("Error").field(err).finish(),
		}
	}
}

impl PartialEq for VfsNode {
	fn eq(&self, other: &Self) -> bool {
		self.name() == other.name()
	}
}

impl Eq for VfsNode {}

impl From<io::Error> for VfsNode {
	fn from(it: io::Error) -> Self {
		VfsNode::Error(it)
	}
}

impl PartialOrd for VfsNode {
	fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
		Some(self.cmp(other))
	}
}

impl Ord for VfsNode {
	fn cmp(&self, other: &Self) -> Ordering {
		match (self, other) {
			(VfsNode::Error(a), VfsNode::Error(b)) => a.kind().cmp(&b.kind()),
			(VfsNode::Error(_), _) => Ordering::Less,
			(_, VfsNode::Error(_)) => Ordering::Greater,
			(a, b) => a.name().cmp(&b.name()),
		}
	}
}

// unsafe impl Send for VfsNode {}

impl VfsNode {
	fn name(&self) -> Option<&String> {
		match self {
			VfsNode::Directory { name, .. } => Some(name),
			VfsNode::File { name, .. } => Some(name),
			VfsNode::Error(_) => None,
		}
	}

	fn size(&self) -> u64 {
		match self {
			VfsNode::Directory { size, .. } => *size,
			VfsNode::File { size, .. } => *size,
			VfsNode::Error(_) => 0,
		}
	}
}

#[async_recursion]
pub async fn scan<P>(path: P) -> VfsNode
where
	P: AsRef<Path> + Send,
{
	let path = path.as_ref();
	let read_dir = fs::read_dir(path).await;

	// println!("{}", path.canonicalize().unwrap().display());

	let read_dir = match read_dir {
		Err(err) => return VfsNode::from(err),
		Ok(read_dir) => {
			tokio_stream::wrappers::ReadDirStream::new(read_dir)
				.collect::<Vec<_>>()
				.await
		}
	};

	// If I end up using a `HashSet`, remember to use `with_capacity`
	let mut contents = BTreeSet::new();

	for entry in read_dir {
		// Get rid of errors that don't have names. We can't really do anything
		// with them, so we just ignore them.
		let Ok(entry) = entry else {
			continue;
		};

		let name = entry.file_name().to_string_lossy().to_string();
		let metadata = entry.metadata().await;

		let metadata = match metadata {
			Err(err) => {
				contents.insert(VfsNode::from(err));
				continue;
			}
			Ok(metadata) => metadata,
		};

		let vfs_node = if metadata.is_file() {
			VfsNode::File {
				name: name.clone(),
				size: metadata.len(),
			}
		} else if metadata.is_dir() {
			unsafe {
				tokio::spawn(async move { scan(entry.path()).await })
					.await
					.or_else(|_| {
						Ok::<VfsNode, Infallible>(VfsNode::Error(io::Error::new(
							io::ErrorKind::Unsupported,
							"not a file or directory",
						)))
					})
					.unwrap_unchecked()
			}
		} else {
			VfsNode::Error(io::Error::new(
				io::ErrorKind::Unsupported,
				"not a file or directory",
			))
		};
		contents.insert(vfs_node);
	}

	VfsNode::Directory {
		name: path.to_string_lossy().to_string(),
		size: contents.iter().map(VfsNode::size).sum(),
		capacity: None,
		contents,
	}
}
