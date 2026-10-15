#!/usr/bin/env bash
# Builds "Saga Techbox Deur OS": a Debian-based live ISO that starts the door server and shows the door screen full-screen by itself.
# Needs a Debian/Ubuntu machine with:  sudo apt-get install live-build   and is run as root:  sudo ./linux-iso/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
WORK="${WORK:-$ROOT/iso-build}"
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

lb config \
  --distribution bookworm --architectures amd64 --binary-images iso-hybrid \
  --mirror-bootstrap http://deb.debian.org/debian --mirror-chroot http://deb.debian.org/debian --mirror-binary http://deb.debian.org/debian \
  --parent-mirror-bootstrap http://deb.debian.org/debian --parent-mirror-chroot http://deb.debian.org/debian --parent-mirror-binary http://deb.debian.org/debian \
  --security true --mirror-chroot-security http://security.debian.org/debian-security --mirror-binary-security http://security.debian.org/debian-security \
  --keyring-packages debian-archive-keyring --archive-areas main \
  --debian-installer none --apt-recommends false --memtest none \
  --iso-application "Saga Techbox Deur" --iso-volume "SAGA_DOOR" \
  --bootappend-live "boot=live components quiet splash hostname=saga-deur username=deur"

# what is on the disc
cp -r "$HERE/config/." config/
mkdir -p config/includes.chroot/opt/saga-door
(cd "$ROOT" && cp -r package.json server.js power.js discover.js seal.js access.js public "$WORK/config/includes.chroot/opt/saga-door/")

lb build
mv -f ./*.iso "$ROOT/Saga-Techbox-Deur-OS-amd64.iso"
echo "Klaar: $ROOT/Saga-Techbox-Deur-OS-amd64.iso"
