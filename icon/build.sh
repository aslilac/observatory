#!/bin/sh
# Render the observatory in Blender (macOS), draw the aperture (Windows, Linux), build
# every platform's icon files into out/, and copy the ones the app ships into
# ../build-resources/.
#   ./build.sh              full quality
#   SAMPLES=32 ./build.sh   quick look
#   NO_RENDER=1 ./build.sh  only redo the layout from existing renders
set -e
cd "$(dirname "$0")"
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
SAMPLES=${SAMPLES:-256}
ICTOOL="/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
mkdir -p renders out/macos

render() {
  name=$1; shift
  "$BLENDER" -b --factory-startup --python observatory.py -- --out "renders/$name.png" --samples "$SAMPLES" "$@" \
    > "renders/$name.log" 2>&1 || { tail -30 "renders/$name.log"; exit 1; }
  echo "rendered $name"
}
if [ -z "$NO_RENDER" ]; then  # NO_RENDER=1 re-lays-out existing renders
  render mac        --variant mac --res 2048 --rising
  render mac-simple --variant mac --res 512 --simple --rising
fi
# Windows and Linux: drawn, not rendered, so it's quick enough to redo every time
for style in windows gnome; do
  for detail in full medium small; do
    python3 aperture.py "renders/aperture-$style-$detail.svg" --style $style --detail $detail > /dev/null
  done
done

uv run --no-project --with pillow --with numpy --with resvg-py python compose.py

# macOS 15 and earlier: .icns from the legacy squircle art
iconutil -c icns out/macos/icon.iconset -o out/macos/icon.icns
# macOS 26+: compile the Icon Composer document into Assets.car (+ a partial Info.plist
# naming the icon), and render what the system will draw, for review
if [ -x "$ICTOOL" ]; then
  xcrun actool out/macos/Observatory.icon --compile out/macos --platform macosx \
    --minimum-deployment-target 11.0 --app-icon Observatory \
    --output-partial-info-plist out/macos/Observatory-partial.plist > out/macos/actool.log 2>&1 \
    || { cat out/macos/actool.log; exit 1; }
  # actool also flattens the .icon into an .icns; icon.icns (Big Sur grid) is the fallback we ship
  rm -f out/macos/Observatory.icns out/macos/Observatory-partial.plist out/macos/actool.log
  mkdir -p out/macos/previews
  for r in Default Dark TintedLight TintedDark ClearLight ClearDark; do
    "$ICTOOL" out/macos/Observatory.icon --export-image --output-file "out/macos/previews/$r.png" \
      --platform macOS --rendition "$r" --width 512 --height 512 --scale 2 > /dev/null 2>&1 \
      || echo "ictool: no $r rendition"
  done
fi
uv run --no-project --with pillow python preview.py

# What the app ships goes into build-resources/, where forge.config.js picks it up
cp out/macos/icon.icns out/windows/icon.ico out/linux/icon.png ../build-resources/
if [ -f out/macos/Assets.car ]; then
  cp out/macos/Assets.car ../build-resources/
fi
# and the About window shows the icon as each platform draws it, at 256px
mkdir -p ../build-resources/about
cp out/macos/icon.iconset/icon_128x128@2x.png ../build-resources/about/darwin.png
cp out/windows/png/icon-256.png ../build-resources/about/win32.png
cp out/linux/hicolor/256x256/apps/ooo.lilac.observatory.png ../build-resources/about/linux.png
# Linux packages (the Flatpak) install the GNOME icons into the icon theme
rm -rf ../build-resources/hicolor
cp -R out/linux/hicolor ../build-resources/
find ../build-resources/hicolor -name .DS_Store -delete
echo "done: out/, and the app's icons in build-resources/"
