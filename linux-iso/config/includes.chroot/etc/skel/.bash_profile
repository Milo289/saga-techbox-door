# the first screen (tty1) starts the graphical door screen by itself
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then exec startx; fi
