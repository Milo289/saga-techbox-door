#!/bin/bash
# Saga Techbox Deur — slimme installatie voor Mac en Linux.
#   Mac:    dubbelklik dit bestand (of sleep het naar Terminal)
#   Linux:  bash Installeer.command
# Het herkent je computer (Mac met Apple-chip of Intel, Linux x64 of ARM), haalt de nieuwste versie
# van GitHub op en start de installatie. Optie:  --dry-run  = alleen laten zien wat het zou kiezen.
set -u
REPO="Milo289/saga-techbox-door"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

OS=$(uname -s); ARCH=$(uname -m); KIND=""
case "$OS" in
  Darwin)
    if [ "$ARCH" = "arm64" ]; then PAT="*mac-arm64.pkg"; WHAT="Mac met Apple-chip"; else PAT="*mac-x64.pkg"; WHAT="Mac met Intel-chip"; fi
    KIND=pkg ;;
  Linux)
    case "$ARCH" in aarch64|arm64) A_DEB="arm64"; A_IMG="arm64" ;; *) A_DEB="amd64"; A_IMG="x86_64" ;; esac
    if command -v dpkg >/dev/null 2>&1; then PAT="*linux-${A_DEB}.deb"; KIND=deb; else PAT="*linux-${A_IMG}.AppImage"; KIND=appimage; fi
    WHAT="Linux-computer ($ARCH)" ;;
  *) echo "Dit systeem wordt niet ondersteund: $OS"; exit 1 ;;
esac

echo "━━━ Saga Techbox Deur installeren ━━━"
echo "Ik zie: $WHAT"
echo "Bestand: $PAT"
[ "$DRY" = 1 ] && exit 0

pause() { [ -t 0 ] && read -r -p "$1" _ || true; }

if ! command -v gh >/dev/null 2>&1; then
  echo
  echo "Voor het downloaden uit jouw privé-GitHub heb ik de gratis hulp ‘gh’ nodig."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Nu installeren met Homebrew? [j/N] " yn
    case "$yn" in j|J|y|Y) brew install gh ;; esac
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "Download het bestand dan met de hand op: https://github.com/$REPO/releases/latest  (kies het bestand dat eindigt op ${PAT#\*})"
    [ "$OS" = Darwin ] && open "https://github.com/$REPO/releases/latest"
    pause "Druk Enter om af te sluiten… "; exit 1
  fi
fi

if ! gh auth status >/dev/null 2>&1; then
  echo
  echo "Log eenmalig in bij GitHub (volg de vragen op het scherm):"
  gh auth login || { pause "Inloggen mislukt. Druk Enter… "; exit 1; }
fi

DEST="$HOME/Downloads"; mkdir -p "$DEST"
echo
echo "Downloaden naar $DEST …"
gh release download --repo "$REPO" --pattern "$PAT" --dir "$DEST" --clobber || { pause "Downloaden mislukte. Druk Enter… "; exit 1; }
FILE=$(ls -t "$DEST"/$PAT 2>/dev/null | head -1)
[ -n "$FILE" ] || { echo "Het gedownloade bestand is niet gevonden."; pause "Druk Enter… "; exit 1; }
echo "Klaar: $FILE"

case "$KIND" in
  pkg)
    open "$FILE"
    echo
    echo "Klik door de installatie. Zegt de Mac dat het bestand niet geopend kan worden: rechtsklik erop → Open → Open."
    pause "Druk hier op Enter als de installatie klaar is… "
    xattr -cr "/Applications/Saga Techbox Deur.app" 2>/dev/null
    open -a "Saga Techbox Deur" 2>/dev/null && echo "✓ Saga Techbox Deur is geopend." ;;
  deb)
    sudo apt install -y "$FILE" && echo "✓ Geïnstalleerd. Zoek ‘Saga Techbox Deur’ in je programma’s." ;;
  appimage)
    chmod +x "$FILE" && echo "✓ Klaar. Start het met:  $FILE" && ("$FILE" >/dev/null 2>&1 &) ;;
esac
pause "Klaar. Druk Enter om dit venster te sluiten… "
