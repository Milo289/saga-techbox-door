#!/bin/sh
xset s off; xset -dpms; xset s noblank
unclutter -idle 1 &
openbox &
# wait until the server is up, then show the door screen full-screen
until curl -fs http://localhost:8080/healthz >/dev/null 2>&1; do sleep 1; done
while true; do
  chromium --kiosk --incognito --no-first-run --noerrdialogs --disable-infobars --disable-translate \
    --autoplay-policy=no-user-gesture-required --user-data-dir=/tmp/door-browser http://localhost:8080/
  sleep 2
done
