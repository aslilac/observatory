// #[tokio::test]
// async fn small_scan() {
// 	dbg!(observatory::scan("/Library/Source/gleam-community/path").await);
// }

// #[tokio::test]
// async fn medium_scan() {
// 	dbg!(observatory::scan("/Library/Source/gleam-community").await);
// }

#[tokio::test]
// #[tokio::test(flavor = "multi_thread", worker_threads = 5)]
async fn big_scan() {
	dbg!(observatory::scan("/Library/Source").await);
}
