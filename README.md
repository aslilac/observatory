# Observatory

Observatory was made out of a desire for a high quality and modern disk usage analysis tool that can be used on all the most popular desktop operating systems. Other alternatives out there are either old, ugly, confusing, platform specific, or some combination of all of these.

Observatory checks all the boxes that no one else does.

- [x] Pretty
- [x] Modern
- [x] Cross platform
- [x] Fast

## Build

Observatory is written in Rust, and drawn with [gpui](https://gpui.rs). To build it, you'll need the latest version of [Rust](https://rustup.rs), and on Linux, the libraries gpui draws and reads input through (`libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev libx11-xcb-dev libxcb1-dev libfontconfig1-dev libfreetype-dev libvulkan-dev` on Debian and Ubuntu).

To run in development:

```shell
cargo run -p observatory
```

Run the tests:

```shell
cargo test
```

Build it for release:

```shell
cargo build --release -p observatory
```

On macOS, `macos/build.sh` packages that as `Observatory.app` in a `.dmg`, and on Linux `flatpak/build.sh` builds and installs it as a Flatpak.

## Performance comparisons

> [!NOTE] Last updated 2026 May 11

### macOS 26

Comparisons run on an MacBook Pro, M1 Max, 64GB memory, 2TB SSD. Scan includes over 5 million files, totaling about 1TB of disk usage.

1. DaisyDisk: 29.1s
2. Observatory: 33.2s
