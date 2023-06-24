use std::collections::VecDeque;
use std::fmt;
use std::fmt::Debug;
use std::io;
use std::path::Path;
use tokio::fs;
use tokio::sync::mpsc;
use tokio_stream::StreamExt;

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
}

// Custom implementation that doesn't print `contents` for `Directory` so that you
// get some output which is actually readable.
impl Debug for VfsNode {
	fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
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
		}
	}
}

impl VfsNode {
	fn size(&self) -> u64 {
		match self {
			VfsNode::Directory { size, .. } => *size,
			VfsNode::File { size, .. } => *size,
		}
	}
}

pub async fn scan<P>(path: P) -> Result<VfsNode, io::Error>
where
	P: AsRef<Path> + Send,
{
	let path = path.as_ref();
	let read_dir = fs::read_dir(path).await?;

	let queue = tokio_stream::wrappers::ReadDirStream::new(read_dir)
		.collect::<VecDeque<_>>()
		.await;

	let (tx, mut rx) = mpsc::unbounded_channel::<VfsNode>();
}

pub async fn blah(tx: mpsc::UnboundedSender<u64>) {}
