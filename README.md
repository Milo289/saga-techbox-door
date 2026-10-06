# Saga Techbox Deur

A door sign people can talk to. The door screen shows **Open**, **Gesloten** or **Bezet**, optionally
*until* a time ("Over 30 minuten gaan we sluiten — om 15:12"), and visitors tap **Deurbel**,
**Tijd booken** or **Vraagje** instead of knocking. You run everything from the control panel
(*bedieningspaneel*) on your computer or phone. All text is Dutch, all times are 24-hour.

| Page | Address | For |
|---|---|---|
| Door screen | `/` | The monitor by the door (vertical, horizontal or rotated) |
| Control panel | `/admin` | You — PIN protected |
| Phone page | `/visit` | Visitors on their own phone |

## Three ways to run it

### 1. The desktop app (macOS, Windows, Linux)
Download the installer from the **Releases** page of this repository:

| System | File |
|---|---|
| Mac with Apple chip (M1 and newer) | `…-mac-arm64.dmg` |
| Mac with Intel chip | `…-mac-x64.dmg` |
| Windows | `…-windows-setup.exe` |
| Linux PC | `…-linux-….AppImage` or `.deb` marked x64 / x86_64 / amd64 |
| Raspberry Pi (64-bit OS) | `…-linux-arm64.AppImage` or `…-linux-arm64.deb` |

On first start the app asks what this computer does:
- **Deurscherm** — shows the door screen full screen and keeps it there (survives restarts, keeps the monitor awake).
- **Bedieningspaneel** — the control panel in its own window, with system notifications.

…and where the server runs: **on this computer** (all-in-one: other devices connect to this computer's
address, which the settings window shows) or **somewhere else** (enter its address).

Shortcuts: **Ctrl/Cmd + Shift + S** opens the settings, **Ctrl/Cmd + Shift + Q** quits (also on the door screen).

The app isn't signed with a paid certificate, so the first time:
- **Mac:** right-click the app → *Open* → *Open*.
- **Windows:** *More info* → *Run anyway*.
- **Linux AppImage:** make it executable (`chmod +x`), then run it.

### 2. Docker
```
docker compose up -d --build
```
Set your PIN and time zone in `docker-compose.yml` (or `ADMIN_PIN=4821 TZ=Europe/Amsterdam docker compose up -d --build`).

### 3. Plain Node.js (18 or newer, nothing to install)
```
ADMIN_PIN=1234 node server.js
```

## Look
- **Donker** — black, calm.
- **Licht** — light background with the status in a big full-colour card (green / red / orange).

Door screen: control panel → *Instellingen* → *Scherm* → *Thema*.
Control panel: *Instellingen* → *Meldingen op dit apparaat* → *Weergave* (per device; can follow the computer).

## Publishing a new version of the app
1. Raise `"version"` in `package.json` (e.g. `1.0.1`) and save a version (see below).
2. Push a tag:
   ```
   git tag v1.0.1 && git push && git push --tags
   ```
3. GitHub builds the Mac, Windows and Linux installers (about 10 minutes) and puts them on the **Releases** page.

You can also start a build without a release: *Actions* tab → *Build app* → *Run workflow*.
Note: on private repositories macOS build minutes count 10×; builds therefore only run when you ask.

## Saving and restoring versions
```
./save.sh "what you changed" works-v3   # save this version (name optional) + zip in backups/
./restore.sh                           # list versions
./restore.sh works-v1                  # put the code back exactly as it was
```
Restoring never touches your live data (`data/`: status, settings, visitors) and saves the current
state first, so nothing is lost.

## Building the app yourself
```
npm install
npm run app          # try it
npm run dist:mac     # or dist:win / dist:linux — installers end up in dist/
```

## Files
| | |
|---|---|
| `server.js` | The server — no dependencies |
| `public/display.html` | Door screen + phone page |
| `public/admin.html` | Control panel |
| `app/` | Desktop app (Electron) |
| `kiosk/` | Start-up scripts for a plain browser kiosk (Windows, Mac) |
| `.github/workflows/build.yml` | Builds the app on GitHub |
