# Observatory app icon

An app icon for [Observatory](https://github.com/aslilac/observatory), a disk usage analyzer that draws a sunburst chart. The building is a calotte dome after the Thirty Meter Telescope: a round aperture in a tilted cap, a grooved shutter ring, a seam where the cap meets the lower dome, and a drum clad in metal panels with a ribbon of glazing under the dome, its X-braced steel frame showing through the glass. Through the aperture you look down the telescope's tube, past the top end (the secondary mirror in a hexagonal frame on six vanes reaching forward), to the segmented primary mirror, and that mirror is the sunburst. Each tile is a folder and each ring is a level of nesting, laid on a shallow concave dish.

On macOS the building is a procedural Blender scene (`observatory.py`), rendered with Cycles and set on a night-sky backplate, after Panic's Transmit icon.

On Windows and Linux the icon is just the aperture (`aperture.py`): looking down the tube, past the top end, to the sunburst. It's a drawing rather than a render, in two styles after each platform's guidelines.

Windows (`--style windows`), after [Microsoft's app icon guidelines](https://learn.microsoft.com/en-us/windows/apps/design/style/iconography/app-icon-design):

- straight-on, with every layer flat and facing the viewer. A disc reads fine head-on, so no side shows.
- subtle gradients at 120°, lighter at the top left.
- depth from Fluent's pair of soft drop shadows (sized on the 48px grid), cast straight down and masked into the layer below. The ring's shadow falls into the tube, past a thin lip.

GNOME (`--style gnome`), after the [GNOME app icon guidelines](https://developer.gnome.org/hig/guidelines/app-icons.html), and laid out like GNOME's Clocks:

- seen a little from above: the ring's front profile shows at the bottom (4px at 128, a shade darker), and the tube's far wall shows at the top of the opening, with the mirror and top end centred below it.
- light from straight above, so the flat surfaces are flat colours from GNOME's palette.
- only hard shadows (2px down at 20%), under the top end, where it needs telling apart from the tiles.
- filling GNOME's 120px circle keyline on the 128 canvas, like its other round icons.

Both have no outlines, and detail only on the sunburst. Each comes in three levels of detail: `full` (three rings of tiles), `medium` (two rings, so the chart reads at 48–64px) and `small` (two chunky rings, a wider opening and no frame or vanes, for 16–32px). Windows uses `full` from 96px up. GNOME uses `medium` at every size from 40px up, because its icons are seen at 64px.

`compose.py` lays everything out per platform, and rasterizes the apertures with resvg at every size rather than scaling one big image down.

Two earlier looks are still around, though the build doesn't use them: `fluent.py` draws the whole building in the same flat style, and `observatory.py --style toon` renders it cel-shaded in EEVEE, with Freestyle ink lines.

```
./build.sh              # render macOS (Blender 4.4, Cycles on Metal), draw the rest, build into out/
SAMPLES=32 ./build.sh   # quick look
NO_RENDER=1 ./build.sh  # redo only the layout from the existing renders
```

Needs Blender at `/Applications/Blender.app` (or `BLENDER=...`), `uv` (for Pillow, numpy and resvg), and Xcode 26+ for the macOS 26 parts (`actool`, and `ictool` from Icon Composer).

## Versions

|  | art | files |
| --- | --- | --- |
| macOS 26+ | building rising up into a night sky, cut off by the bottom edge. macOS draws the rounded mask and shadow | `out/macos/Observatory.icon` (Icon Composer document), `out/macos/Assets.car` (compiled from it) |
| macOS 15 and earlier | the same art on the Big Sur grid (824px squircle in 1024, baked shadows) | `out/macos/icon.icns` |
| Windows | the aperture in the Windows style, filling the 48px grid, no shadow outside the shape | `out/windows/icon.ico` (16–256, 14 sizes), `out/windows/png/` |
| Linux | the aperture in the GNOME style, on GNOME's grid | `out/linux/hicolor/scalable/apps/ooo.lilac.observatory.svg`, `out/linux/hicolor/<size>/apps/ooo.lilac.observatory.png`, `out/linux/icon.png` |
| GNOME symbolic | a one-colour 16px glyph: the ring, the sunburst as three segments, the hexagonal secondary | `symbolic.svg` → `out/linux/hicolor/symbolic/apps/ooo.lilac.observatory-symbolic.svg` |

The macOS renders use `--rising`: the plinth is left out and the drum carries on below the frame, so the bottom edge only ever cuts through brick. Below 40px, the building is rendered with `--simple` (no windows, seam or grooves, and two chunky rings of tiles instead of three). `out/preview.png` shows every size on light and dark, and `out/macos/previews/` has the Default, Dark, Tinted and Clear renditions macOS makes from the `.icon`.

## Using it in the Electron app

`build.sh` ends by copying what the app ships into `build-resources/`, where `forge.config.js` picks it up. A `SAMPLES=32` quick look lands there too, so don't commit that one.

- `icon.icns` and `icon.ico`: Forge's `packagerConfig.icon: "./build-resources/icon"` picks the extension per platform. The `.ico` is also Squirrel's `setupIcon`.
- `Assets.car`: a `packageAfterCopy` hook puts it in `Contents/Resources` (macOS builds only), and `extendInfo` names it with `CFBundleIconName: "Observatory"`. macOS 26+ draws the icon from it, and older systems fall back to the `.icns`.
- `hicolor/`: the GNOME icons as an icon theme, for Linux packages (see below). `icon.png` is the 512px one, which nothing uses yet.
- `about/darwin.png`, `about/win32.png`, `about/linux.png`: the About window shows the one for the platform it's on, at 256px: the macOS legacy art, the Windows aperture, and the GNOME aperture.

You can open `out/macos/Observatory.icon` in Icon Composer to adjust the layers (glass, shadow, translucency) by hand.

On Linux the icon comes from the `.desktop` file a package installs (GNOME on Wayland matches windows to it by app id, and ignores `BrowserWindow`'s `icon`). The Flatpak (`flatpak/`) installs `build-resources/hicolor/` into `/app/share/icons/hicolor/` and names it with `Icon=ooo.lilac.observatory`, and `desktopName` in package.json gives the window the same app id.
