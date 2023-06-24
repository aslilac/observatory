use std::fmt;
use std::fmt::Debug;
use std::fs;
use std::io;
use std::path::Path;

pub enum VfsNode {
	Directory {
		name: String,
		size: u64,
		capacity: Option<u64>,
		contents: Vec<VfsNode>,
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
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
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

impl From<io::Error> for VfsNode {
	fn from(it: io::Error) -> Self {
		VfsNode::Error(it)
	}
}

impl VfsNode {
	fn size(&self) -> u64 {
		match self {
			VfsNode::Directory { size, .. } => *size,
			VfsNode::File { size, .. } => *size,
			VfsNode::Error(_) => 0,
		}
	}
}

pub fn scan<P>(path: P) -> VfsNode
where
	P: AsRef<Path> + Send,
{
	let path = path.as_ref();
	let read_dir = fs::read_dir(path);

	let read_dir = match read_dir {
		Err(err) => return VfsNode::from(err),
		Ok(read_dir) => read_dir,
	};

	let contents = read_dir
		.flatten()
		.map(|entry| {
			let name = entry.file_name().to_string_lossy().to_string();
			let metadata = entry.metadata();

			let metadata = match metadata {
				Err(err) => {
					return VfsNode::from(err);
				}
				Ok(metadata) => metadata,
			};

			if metadata.is_dir() {
				scan(entry.path())
			} else if metadata.is_file() {
				VfsNode::File {
					name: name.clone(),
					size: metadata.len(),
				}
			} else {
				VfsNode::Error(io::Error::new(
					io::ErrorKind::Unsupported,
					"not a file or directory",
				))
			}
		})
		.collect::<Vec<_>>();

	VfsNode::Directory {
		name: path.to_string_lossy().to_string(),
		size: contents.iter().map(VfsNode::size).sum(),
		capacity: None,
		contents,
	}
}
