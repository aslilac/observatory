#!/bin/sh
# Render the hero scene (Blender 4.4, Cycles on Metal) and put it on the site.
#   ./build.sh                     full quality
#   SAMPLES=24 WIDTH=1280 ./build.sh   quick look
#   NO_RENDER=1 ./build.sh         only redo the images and icons from the last render
set -e
cd "$(dirname "$0")"
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
SAMPLES=${SAMPLES:-256}
WIDTH=${WIDTH:-2880}
mkdir -p out
if [ -z "$NO_RENDER" ]; then
  "$BLENDER" -b --factory-startup --python hero.py -- --out out/hero.png --width "$WIDTH" --samples "$SAMPLES" \
    > out/hero.log 2>&1 || { tail -30 out/hero.log; exit 1; }
  echo "rendered hero"
fi
uv run --no-project --with pillow python publish.py
