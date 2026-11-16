#!/bin/sh
# Build the gpui app (src/desktop) for macOS: Observatory.app, a .dmg to
# install it from, and a .zip of the app for the updater. Apple silicon only.
# Everything lands in target/macos/.
#
#   macos/build.sh               signed ad hoc: runs here, and on another Mac
#                                once Gatekeeper's been talked round
#   APPLE_TEAM_ID=… macos/build.sh
#                                signed with that team's Developer ID
#                                certificate, from the keychain
#   … APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… macos/build.sh
#                                and notarized, so it opens anywhere
#
# They're the variables the release workflow already has. SIGN_IDENTITY names
# a certificate outright, if the team has more than one.
set -e
cd "$(dirname "$0")/.."

TARGET=aarch64-apple-darwin
VERSION=$(cargo metadata --no-deps --format-version 1 |
  python3 -c 'import json, sys; print(next(p["version"] for p in json.load(sys.stdin)["packages"] if p["name"] == "observatory"))')
OUT=target/macos
APP=$OUT/Observatory.app
NAME=Observatory-darwin-arm64-$VERSION

# gpui's Metal shaders are compiled by the build if Xcode's Metal Toolchain
# is there (xcodebuild -downloadComponent MetalToolchain), and by the app
# each time it starts if not, which costs it a moment.
if xcrun -sdk macosx metal --version > /dev/null 2>&1; then
  FEATURES="--no-default-features"
else
  FEATURES=""
  echo "no Metal Toolchain: the shaders will be compiled when the app starts"
fi
# Without its symbols, which are a good part of its size.
# shellcheck disable=SC2086
CARGO_PROFILE_RELEASE_STRIP=symbols cargo build --release -p observatory --target $TARGET $FEATURES

rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "target/$TARGET/release/observatory" "$APP/Contents/MacOS/Observatory"
cp build-resources/icon.icns build-resources/Assets.car "$APP/Contents/Resources/"
cp macos/Info.plist "$APP/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$VERSION" "$APP/Contents/Info.plist"

# Signed with a certificate if there's a team to sign as, with the hardened
# runtime, which notarizing asks for. Ad hoc otherwise: Apple silicon won't
# run a binary with no signature at all.
if [ -n "$APPLE_TEAM_ID" ] && [ -z "$SIGN_IDENTITY" ]; then
  SIGN_IDENTITY=$(security find-identity -v -p codesigning |
    sed -n "s/.*\"\(Developer ID Application: .*($APPLE_TEAM_ID)\)\"/\1/p" | head -1)
  if [ -z "$SIGN_IDENTITY" ]; then
    echo "no Developer ID Application certificate for team $APPLE_TEAM_ID in the keychain" >&2
    exit 1
  fi
fi
if [ -n "$SIGN_IDENTITY" ]; then
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
else
  codesign --force --sign - "$APP"
fi
codesign --verify --strict "$APP"

# Apple checks the app and hands back a ticket, which is stapled to it so it
# opens without asking Apple first.
notarize() {
  xcrun notarytool submit "$1" --wait \
    --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"
}
NOTARIZE=
if [ -n "$SIGN_IDENTITY" ] && [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
  NOTARIZE=1
  # notarytool takes an archive, not a folder. This one's only for it.
  ditto -c -k --keepParent "$APP" "$OUT/notarize.zip"
  notarize "$OUT/notarize.zip"
  rm "$OUT/notarize.zip"
  xcrun stapler staple "$APP"
fi

# The app by itself, for the updater to swap in.
ditto -c -k --keepParent "$APP" "$OUT/$NAME.zip"

# The disk image: the app beside a way into Applications, to drag it to.
STAGE=$OUT/dmg
mkdir "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname Observatory -srcfolder "$STAGE" -fs HFS+ -format ULMO -ov "$OUT/$NAME.dmg" > /dev/null
rm -rf "$STAGE"
if [ -n "$SIGN_IDENTITY" ]; then
  codesign --force --timestamp --sign "$SIGN_IDENTITY" "$OUT/$NAME.dmg"
fi
if [ -n "$NOTARIZE" ]; then
  notarize "$OUT/$NAME.dmg"
  xcrun stapler staple "$OUT/$NAME.dmg"
fi

echo "built $APP"
echo "      $OUT/$NAME.dmg"
echo "      $OUT/$NAME.zip"
