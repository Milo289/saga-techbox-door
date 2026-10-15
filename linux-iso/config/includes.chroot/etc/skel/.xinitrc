#!/bin/sh
xset s off; xset -dpms; xset s noblank
unclutter -idle 1 &
openbox &
# show a waiting page at once; it sends the browser to the door screen as soon as the server answers
while true; do
  chromium --kiosk --incognito --no-first-run --noerrdialogs --disable-infobars --disable-translate --allow-file-access-from-files \
    --autoplay-policy=no-user-gesture-required --user-data-dir=/tmp/door-browser file:///opt/saga-door/loading.html
  sleep 2
done
