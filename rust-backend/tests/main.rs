use std::time::Instant;

// #[tokio::test]
// async fn small_scan() {
// 	dbg!(observatory::scan("/Library/Source/gleam-community/path").await);
// }

// #[tokio::test]
// async fn medium_scan() {
// 	dbg!(observatory::scan("/Library/Source/gleam-community").await);
// }

// 22.7s
// #[test]
// fn v1_big_scan() {
// 	let scan_time = Instant::now();
// 	dbg!(observatory::v1::scan("/Library/Source"));
// 	dbg!(scan_time.elapsed());
// }

// 32.7s
// #[tokio::test]
// async fn v2_big_scan() {
// 	let scan_time = Instant::now();
// 	dbg!(observatory::v2::scan("/Library/Source").await);
// 	dbg!(scan_time.elapsed());
// }

// 32.3s
// #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
// #[tokio::test]
// async fn v3_big_scan() {
// 	let scan_time = Instant::now();
// 	dbg!(observatory::v3::scan("/Library/Source").await.unwrap());
// 	dbg!(scan_time.elapsed());
// }

#[tokio::test]
async fn v4_big_scan() {
	let scan_time = Instant::now();
	dbg!(observatory::v4::scan("/Library/Source").await.unwrap());
	dbg!(scan_time.elapsed());
}
