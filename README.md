# Door Display

A sign for your door in black that people can talk to. It shows **Open**, **Closed** or **Busy**,
optionally *until* a time, and visitors tap a reason instead of knocking on the window.
You control it from your phone or computer.

## Start it

Install Docker Desktop, then in this folder:

```
docker compose up -d --build
```

| Page | Address | Use |
|---|---|---|
| Door screen | http://localhost:8080/ | Full screen on the door monitor |
| Control panel | http://localhost:8080/admin | Your phone or computer (PIN **1234**; change it in `docker-compose.yml`) |
| Phone page | http://localhost:8080/visit | Same buttons, for a visitor's own phone |

From another device, use the computer's network address instead of `localhost` (e.g. `http://192.168.1.50:8080`).

Set your own PIN and time zone:
```
ADMIN_PIN=4821 TZ=Europe/Amsterdam docker compose up -d --build
```

### Full screen on the door monitor
```
google-chrome --kiosk --noerrdialogs --disable-session-crashed-bubble http://SERVER-IP:8080/
```
(Raspberry Pi: `chromium-browser --kiosk ...`.) Or double-tap the clock on the door screen.

### Vertical or horizontal
Control panel → Settings → Screen: Automatic, Vertical or Horizontal, plus **Rotate** for a monitor
turned on its side. Per screen: `/?orientation=portrait&rotate=90` (`&keyboard=0` hides the touch keyboard).

## How the status works

| You choose | Door shows | Afterwards |
|---|---|---|
| Open, until 17:00 | **Open** until 17:00 | switches to Closed |
| Closed, until 13:00 | **Closed** until 13:00 | switches to Open |
| Busy, until 15:30 | **Busy** until 15:30 | switches to Open |
| Busy during 14:00–15:00 (planned) | upcoming time shown under the status; at 14:00 **Busy** until 15:00 | back to what it was |
| No end | stays until you change it | — |

With **opening hours** turned on, the door opens and closes by itself (e.g. Mon–Fri 09:00–17:00) and
shows "Closed until tomorrow 09:00". A change by hand always wins until the next opening or closing time.

## Visitors
- Tap a **reason** (you choose the list): "Delivery", "Quick question", …
- **Doorbell**: on when Open. While Closed/Busy it shows "Doorbell off" (or keep it on in Settings).
- **Book a time**: shows only free times (from your opening hours, not during busy times or other appointments).
- **Message**.
- Your **reply** ("One minute please") appears in big letters on the door. Instant reply while closed, and an automatic reply if you don't answer within X minutes.

You get a sound and a pop-up in the control panel, and a **phone push** through the free *ntfy* app (Settings → Phone notifications).

## Reliability
- The door screen loads straight away, reconnects by itself, falls back to checking every few seconds if the live connection drops, and shows "Reconnecting…" only if it's really offline.
- No internet needed: no emoji, fonts or scripts from the web.
- It keeps the screen awake where the browser allows it, hides the mouse pointer, and reloads itself after you update the app.

## Without Docker
```
node server.js
```
Node 18+, nothing to install. Data is in the `door-data` volume (or `./data/state.json` without Docker).
