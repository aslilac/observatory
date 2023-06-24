use std::fmt;
use std::fmt::Debug;
use std::future::Future;
use std::io;
use std::path::Path;
use std::pin::Pin;
use tokio::fs;
use tokio_stream::wrappers::ReadDirStream;
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

unsafe impl Send for VfsNode {}

impl VfsNode {
	fn size(&self) -> u64 {
		match self {
			VfsNode::Directory { size, .. } => *size,
			VfsNode::File { size, .. } => *size,
		}
	}
}

pub fn scan<P>(path: P) -> Pin<Box<dyn Future<Output = Result<VfsNode, io::Error>> + Send>>
where
	P: AsRef<Path> + Send,
{
	let path = path.as_ref().to_path_buf();

	Box::pin(async move {
		let path = path;
		let read_dir = fs::read_dir(&path).await?;

		tokio::spawn(async {
			ReadDirStream::new(read_dir)
				.then(|entry| async {
					// Get rid of errors that don't have names. We can't really do anything
					// with them, so we just ignore them.
					let entry = entry.ok()?;
					let name = entry.file_name().to_string_lossy().to_string();
					let metadata = entry.metadata().await.ok()?;

					if metadata.is_dir() {
						scan(entry.path()).await.ok()
					} else if metadata.is_file() {
						Some(VfsNode::File {
							name: name.clone(),
							size: metadata.len(),
						})
					} else {
						None
					}
				})
				.filter_map(|it| it)
				.collect::<Vec<_>>()
				.await;
		});

		Ok(VfsNode::Directory {
			name: path.to_string_lossy().to_string(),
			size: 0,
			capacity: None,
			contents: vec![],
		})
	})
}
