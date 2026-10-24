# Flatpak

`ooo.lilac.observatory.yml` builds Observatory from this checkout on the Electron base app, all of it inside the Freedesktop SDK: pnpm install, the Rust scanner, `electron-vite build` and `electron-forge package`. The build has network access, so pnpm, cargo and Electron fetch what they need as they would anywhere else. That's fine for building it yourself, though Flathub would want every download listed as a source.

```sh
./build.sh                      # build and install for this user
flatpak run ooo.lilac.observatory
```

`build.sh` adds Flathub for the user if it isn't there, installs `org.flatpak.Builder`, and builds into `build/` here, keeping flatpak-builder's state in `.flatpak-builder/`.

## How it gets at the disks

A disk usage analyzer needs to see the whole disk, so the sandbox has `--filesystem=host-root` (Flatpak 1.17+): the host's whole filesystem tree, every mount included, at `/run/host/root`. The mount table in the sandbox lists the host's mounts there too, so the volume list and the scanner's mount plan (`rust-backend/mounts.rs`) work on the host's layout:

- The startup disk is listed as `/run/host/root`, and its scan goes from there. On an ostree system (Bazzite, Silverblue), how full it is comes from `/run/host/root/sysroot`.
- A disk the sandbox also has at its own place (removable disks under `/run/media`, from `--filesystem=host`) is listed at that place.
- Reveal hands the file manager the host's path, without `/run/host/root`.

`--filesystem=host` also keeps the home folder and other folders picked in the file chooser at their usual paths.
