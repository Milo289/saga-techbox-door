#!/usr/bin/env bash
# Zet de app in je eigen map (geen beheerderswachtwoord nodig) en maakt een snelkoppeling in het menu.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/share/saga-techbox-beheer"
mkdir -p "$BIN" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
cp "$HERE/SagaTechboxBeheer" "$BIN/" && chmod +x "$BIN/SagaTechboxBeheer"
cp "$HERE/saga-techbox-beheer.png" "$HOME/.local/share/icons/hicolor/512x512/apps/saga-techbox-beheer.png"
sed "s|^Exec=.*|Exec=$BIN/SagaTechboxBeheer|" "$HERE/saga-techbox-beheer.desktop" > "$HOME/.local/share/applications/saga-techbox-beheer.desktop"
echo "Klaar. Zoek in je programmamenu naar “Saga Techbox Beheer”."
