#!/bin/bash
# Builds the iPhone/iPad app and installs it on a phone that is connected with a cable.
#
#   ./install.sh                  the normal app            (Deur Beheer)
#   ./install.sh dev              the developer app         (Deur Dev — installs next to the normal one)
#   ./install.sh --sim [dev]      the simulator instead of a phone
#
# Options:  --team TEAMID   your Apple team (or set TEAM_ID); find it in Xcode → Settings → Accounts → Manage Certificates,
#                           or at developer.apple.com → Membership. A free Apple ID works too (the app then lasts 7 days).
#           --device NAME   the phone to use (name or id); without it the first connected phone is used.
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")"

KIND=normal; SIM=0; TEAM="${TEAM_ID:-}"; DEVICE=""
while [ $# -gt 0 ]; do
  case "$1" in
    dev) KIND=dev ;;
    normal) KIND=normal ;;
    --sim) SIM=1 ;;
    --team) TEAM="$2"; shift ;;
    --device) DEVICE="$2"; shift ;;
    -h|--help) sed -n '2,10p' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
  shift
done

if [ "$KIND" = dev ]; then SCHEME=DeurBeheerDev; APP=DeurBeheerDev; BUNDLE=nl.sagatechbox.beheer.dev; NAME="Deur Dev"
else SCHEME=DeurBeheer; APP=DeurBeheer; BUNDLE=nl.sagatechbox.beheer; NAME="Deur Beheer"; fi

command -v xcodegen >/dev/null || { echo "xcodegen is needed:  brew install xcodegen"; exit 1; }
command -v xcodebuild >/dev/null || { echo "Xcode is needed (install it from the App Store)."; exit 1; }
if [ -z "${DEVELOPER_DIR:-}" ] && [ ! -d "$(xcode-select -p 2>/dev/null)/Platforms" ]; then
  for X in /Applications/Xcode.app /Applications/Xcode-beta.app; do [ -d "$X" ] && export DEVELOPER_DIR="$X/Contents/Developer" && break; done
fi

echo "› Project maken…"
xcodegen generate >/dev/null

if [ "$SIM" = 1 ]; then
  echo "› $NAME bouwen voor de simulator…"
  xcodebuild -project DeurBeheer.xcodeproj -scheme "$SCHEME" -configuration Debug -sdk iphonesimulator -derivedDataPath build-sim CODE_SIGNING_ALLOWED=NO build -quiet
  echo "› Installeren op de simulator die nu aan staat…"
  xcrun simctl install booted "build-sim/Build/Products/Debug-iphonesimulator/$APP.app"
  xcrun simctl launch booted "$BUNDLE" >/dev/null && echo "✓ $NAME draait in de simulator."
  exit 0
fi

[ -n "$TEAM" ] || { echo "Geef je Apple-team op:  ./install.sh ${KIND/normal/} --team JOUWTEAMID   (of zet TEAM_ID). Zie --help."; exit 1; }

echo "› $NAME bouwen voor je telefoon… (de eerste keer duurt dit even)"
xcodebuild -project DeurBeheer.xcodeproj -scheme "$SCHEME" -configuration Release -sdk iphoneos -derivedDataPath build \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" build -quiet

echo "› Telefoon zoeken…"
LIST=$(mktemp); xcrun devicectl list devices --json-output "$LIST" >/dev/null 2>&1 || true
ID=$(python3 - "$LIST" "$DEVICE" <<'PY'
import json, sys
try: devs = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception: devs = []
want = sys.argv[2].lower()
for d in devs:
    p = d.get("hardwareProperties", {}); n = d.get("deviceProperties", {}).get("name", "")
    if p.get("platform") not in ("iOS", "iPadOS"): continue
    if want and want not in (n.lower(), d.get("identifier", "").lower()): continue
    if d.get("connectionProperties", {}).get("tunnelState") in ("connected", "disconnected") or True:
        print(d["identifier"]); break
PY
)
[ -n "$ID" ] || { echo "Geen telefoon gevonden. Sluit hem aan met een kabel, ontgrendel hem en tik op ‘Vertrouw’. Zet daarna Instellingen → Privacy en beveiliging → Ontwikkelaarsmodus aan."; exit 1; }

echo "› Installeren…"
xcrun devicectl device install app --device "$ID" "build/Build/Products/Release-iphoneos/$APP.app"
xcrun devicectl device process launch --device "$ID" "$BUNDLE" >/dev/null 2>&1 || true
echo "✓ $NAME staat op je telefoon."
echo "  Eerste keer: Instellingen → Algemeen → VPN en apparaatbeheer → vertrouw jezelf."
