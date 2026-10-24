#!/bin/sh
# Chromium's sandbox can't set itself up inside Flatpak's, so zypak (from
# the Electron base app) hands it Flatpak's own to use instead.
exec zypak-wrapper /app/main/Observatory "$@"
