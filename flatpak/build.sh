#!/bin/sh
# Builds the Flatpak from this checkout and installs it for this user.
set -e
cd "$(dirname "$0")"

# The build's copy of the checkout leaves .git out, so the commit (for the
# about window and bug reports, see electron.vite.config.ts) goes in .commit,
# marked -dirty if there are changes.
if sha=$(git rev-parse HEAD 2>/dev/null); then
	[ -z "$(git status --porcelain)" ] || sha="$sha-dirty"
	echo "$sha" >../.commit
else
	rm -f ../.commit
fi

flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --noninteractive flathub org.flatpak.Builder
flatpak run org.flatpak.Builder --user --install --install-deps-from=flathub --force-clean \
	build ooo.lilac.observatory.yml
echo "installed: flatpak run ooo.lilac.observatory"
