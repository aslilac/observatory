#!/bin/sh
# Builds the Flatpak from this checkout and installs it for this user.
set -e
cd "$(dirname "$0")"

flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --noninteractive flathub org.flatpak.Builder
flatpak run org.flatpak.Builder --user --install --install-deps-from=flathub --force-clean \
	build ooo.lilac.observatory.yml
echo "installed: flatpak run ooo.lilac.observatory"
