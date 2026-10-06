#!/bin/bash
# Door screen installer for macOS: starts the door screen full screen at every login.
cd "$(dirname "$0")"
echo
echo "Door screen setup"
echo "Where does the door server run?"
echo "  - On this Mac (Docker Desktop): just press Enter"
echo "  - On another computer: type its address, e.g. http://192.168.1.50:8080"
read -rp "Server address: " URL
URL="${URL:-http://localhost:8080}"

APP="$HOME/Library/Application Support/DoorScreen"
mkdir -p "$APP"
install -m 755 door-screen.sh "$APP/door-screen.sh"
echo "$URL" > "$APP/url"

PLIST="$HOME/Library/LaunchAgents/com.doorscreen.kiosk.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.doorscreen.kiosk</string>
  <key>ProgramArguments</key><array><string>$APP/door-screen.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"
echo
echo "Done. The door screen starts now and at every login. If it is closed it reopens by itself."
echo "To stop it for now: launchctl unload \"$PLIST\"; pkill -f door-screen.sh"
echo "To remove it: launchctl unload \"$PLIST\" && rm \"$PLIST\""
echo "Tip: System Settings → Users & Groups → automatic login, so it also starts after a power cut."
