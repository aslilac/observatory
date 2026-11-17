# Flatpak

`ooo.lilac.observatory.yaml` builds Observatory (the gpui app, `src/desktop`) from this checkout inside the Freedesktop SDK: one `cargo build`, and the program, its desktop entry, and its icons installed. It runs on the plain Freedesktop runtime, with no base app. The build has network access, so cargo fetches the crates as it would anywhere else. That's fine for building it yourself, though Flathub would want every crate listed as a source.

A Flatpak copy doesn't look for new versions: Flatpak updates it.

```sh
./build.sh                      # build and install for this user
flatpak run ooo.lilac.observatory
```

`build.sh` adds Flathub for the user if it isn't there, installs `org.flatpak.Builder`, and builds into `build/` here, keeping flatpak-builder's state in `.flatpak-builder/`.

## How it gets at the disks

A disk usage analyzer needs to see the whole disk, so the sandbox has `--filesystem=host-root` (Flatpak 1.17+): the host's whole filesystem tree, every mount included, at `/run/host/root`. The mount table in the sandbox lists the host's mounts there too, so the volume list and the scanner's mount plan (`src/scanner/mounts.rs`) work on the host's layout:

- The startup disk is listed as `/run/host/root`, and its scan goes from there. On an ostree system (Bazzite, Silverblue), how full it is comes from `/run/host/root/sysroot`.
- A disk the sandbox also has at its own place (removable disks under `/run/media`, from `--filesystem=host`) is listed at that place.
- Reveal hands the file manager the host's path, without `/run/host/root`.

`--filesystem=host` also keeps the home folder and other folders picked in the file chooser at their usual paths.
