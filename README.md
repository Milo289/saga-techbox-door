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

## Accounts, rights and the API

By default the control panel opens with a PIN (`ADMIN_PIN`) — or without protection if you set nothing.
For a real login, run this once on the computer that has the code:

```
npm run login        # asks for a username and password (hidden) and writes them, as a hash, to access.js
```
Then restart the server (or build the app again). That login always has every right. Keep the password safe — there is no reset.

On the login screen, **Onthoud mij** keeps you logged in for a year. In the desktop app your login is stored **encrypted by your
computer's own secure storage** (Keychain on macOS, Credential Vault on Windows, the keyring on Linux), so the app signs in by itself;
logging out forgets it. The password itself is never written anywhere in plain text.

With it you get a **Beheer** tab:
- **Gebruikers** — create accounts with a role (*beheerder*, *medewerker*, *kijker*) and tick exactly which rights each person has:
  see status · change status/message/busy times · see and answer visitors · manage people · change settings · set up mail ·
  backups · see the log · manage users · manage API keys. Nobody can give rights they don't have themselves.
- **Ingelogd** — who is logged in where; end sessions at once.
- **API-sleutels** — keys for scripts and other programs, each with only the rights you choose; shown once, revocable.
- **Activiteitenlog** — who did what, including failed logins and refused actions.
- **Server** — version, uptime, connected screens.

People only see the tabs and buttons they have rights for, and the server enforces it as well. Passwords are stored as scrypt hashes;
too many wrong attempts are blocked for a while. The old PIN keeps working as a *beheerder* (remove `ADMIN_PIN` to turn it off).

### API (for scripts, Home Assistant, your own website)
Send a key from the Beheer tab as `Authorization: Bearer door_…`.
```
GET  /api/v1/status                      POST /api/v1/status          {"mode":"closed","minutes":30}
GET  /api/v1/requests?state=open         POST /api/v1/requests/reply  {"id":"…","reply":"Ik kom eraan"}
GET  /api/v1/users                       POST /api/v1/users           {"username":"anna","name":"Anna","password":"…","role":"medewerker"}
                                         POST /api/v1/users/remove    {"id":"…"}
GET  /api/v1/people                      POST /api/v1/people/upsert   {"nr":"1042","name":"Sam","email":"sam@bedrijf.nl"}
GET  /api/v1/audit
```
Examples with `curl` are shown in the Beheer tab itself.

## What only the desktop app can do
Install the app (see above) and you get, on top of the website:
- an **icon in the system tray** with quick *Open / Gesloten / Bezet* buttons and the number of open requests (also a badge on the app icon on Mac/Linux)
- **global shortcuts** — Ctrl/Cmd+Alt+**O** / **G** / **B** set the status from any program
- real **system notifications**, the window can **stay running in the tray** when closed
- the door screen on a **chosen monitor**, optionally in a window, with a **daily refresh** (e.g. 04:00)
- **always on top**, **zoom**, start at login (Windows, macOS, Linux)
- backups **saved to / restored from a file** with the normal save/open dialogs, and *open data folder*

All of these are in *Instellingen → Venster en sneltoetsen* (Ctrl/Cmd+Shift+S) and on the *Deze app* card in the control panel.

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
