#!/bin/bash
# Saga Techbox Deur — slimme installatie voor Mac en Linux.
#   Mac:    dubbelklik dit bestand (of sleep het naar Terminal)
#   Linux:  bash Installeer.command
# Het herkent je computer (Mac met Apple-chip of Intel, Linux x64 of ARM), haalt de nieuwste versie
# van GitHub op (ook developer betas) en start de installatie.
# Opties:  --stabiel = alleen gewone versies   --dry-run = alleen laten zien wat het zou kiezen.
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

DEST="$HOME/Downloads"; mkdir -p "$DEST"
echo
echo "Zoeken naar de nieuwste versie …"
if [ "${1:-}" = "--stabiel" ]; then API="https://api.github.com/repos/$REPO/releases/latest"; else API="https://api.github.com/repos/$REPO/releases?per_page=30"; fi
RE=$(printf '%s' "${PAT#\*}" | sed 's/\./\\./g')
URL=$(curl -fsSL -H "User-Agent: saga-installeer" "$API" 2>/dev/null | grep -oE '"browser_download_url": ?"[^"]+"' | grep -E "${RE}\"\$" | head -1 | cut -d'"' -f4)
if [ -z "$URL" ]; then
  echo "Ik vond geen bestand voor deze computer. Download het met de hand op: https://github.com/$REPO/releases  (kies het bestand dat eindigt op ${PAT#\*})"
  [ "$OS" = Darwin ] && open "https://github.com/$REPO/releases"
  pause "Druk Enter om af te sluiten… "; exit 1
fi
echo "Downloaden naar $DEST …"
curl -fL --progress-bar -o "$DEST/$(basename "$URL")" "$URL" || { pause "Downloaden mislukte. Druk Enter… "; exit 1; }
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
