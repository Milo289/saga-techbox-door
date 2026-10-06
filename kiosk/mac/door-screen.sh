#!/bin/bash
# Shows the door screen full screen (no browser bars) and keeps it there:
# waits for the door server, restarts the screen if it closes, keeps the display awake.
URL="${1:-$(cat "$HOME/Library/Application Support/DoorScreen/url" 2>/dev/null || echo http://localhost:8080)}"
URL="${URL%/}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
[ -x "$CHROME" ] || { echo "Install Google Chrome first"; exit 1; }
PROFILE="$HOME/Library/Application Support/DoorScreen/browser"

caffeinate -dimsu -w $$ &   # keep the display on while this runs
while true; do
  until curl -fs -o /dev/null --max-time 3 "$URL/healthz"; do sleep 3; done
  sed -i '' 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PROFILE/Default/Preferences" 2>/dev/null
  "$CHROME" --kiosk --app="$URL/" --user-data-dir="$PROFILE" --no-first-run --noerrdialogs \
    --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required \
    --overscroll-history-navigation=0 --disable-pinch >/dev/null 2>&1
  sleep 2
done
