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

## The easy way: one installer that recognises your device
Open `installeren.html` (it detects your device and shows the right download first), or download **Installeer-Mac-Linux.zip** / **Installeer-Windows.zip** from the Releases page, unzip, and double-click `Installeer.command` (Mac; Linux: `bash Installeer.command`) or `Installeer-Windows.bat`. It sees whether you have an Apple-chip Mac, an Intel Mac, Windows or Linux, downloads the newest version through the GitHub CLI (`gh`, one-time login) and starts the installation. `--dry-run` / `-DryRun` only shows what it would pick.

**Keeping the iPhone/iPad app alive without a paid developer account:** apps installed with a free Apple ID stop after 7 days (an Apple rule). Options: put the web app on the home screen (Safari → Share → *Zet op beginscherm*; free and permanent), use AltStore/SideStore, which refreshes the app by itself every week, or pay for the Apple Developer Program (a year, or TestFlight). The Mac, Windows and Linux apps have no such limit. Details are on `installeren.html`. The plan for future updates is in `ROADMAP.md`.

## Three ways to run it

### 1. The desktop app (macOS, Windows, Linux)
Download the installer from the **Releases** page of this repository:

| System | File |
|---|---|
| Mac with Apple chip (M1 and newer) | `…-mac-arm64.pkg` (or `.dmg`) |
| Mac with Intel chip | `…-mac-x64.pkg` (or `.dmg`) |
| Windows | `…-windows-setup.exe` |
| Linux PC | `…-linux-….AppImage` or `.deb` marked x64 / x86_64 / amd64 |
| Raspberry Pi (64-bit OS) | `…-linux-arm64.AppImage` or `…-linux-arm64.deb` |

On first start the app asks one question: **what is this computer?**
- **Alles-in-één** — this computer runs the server and the control panel (easiest; other devices connect to its address).
- **Deurscherm** — the monitor by the door, full screen (survives restarts, keeps the monitor awake). The server runs here or elsewhere.
- **Bedieningspaneel** — your workplace: the control panel in its own window, with system notifications. The server runs here or elsewhere.
- **Alleen de server** — no window; the server runs in the background and a tray icon shows its address.

The iPhone/iPad app asks the same: *Bedieningspaneel* (login, Face ID, Siri) or *Deurscherm* (an iPad or iPhone by the door; stays on, five taps top-left open its settings).

Shortcuts: **Ctrl/Cmd + Shift + S** opens the settings, **Ctrl/Cmd + Shift + Q** quits (also on the door screen).

The app isn't signed with a paid certificate, so the first time:
- **Mac:** right-click the app → *Open* → *Open*.
- **Windows:** *More info* → *Run anyway*.
- **Linux AppImage:** make it executable (`chmod +x`), then run it.

### 2. Docker
```
docker compose up -d --build
```
Set the time zone in `docker-compose.yml` (or `TZ=Europe/Amsterdam docker compose up -d --build`). There is no PIN by default; log in with an account. An old-style PIN is optional: `ADMIN_PIN=4821 docker compose up -d --build`.

### 3. Plain Node.js (18 or newer, nothing to install)
```
ADMIN_PIN=1234 node server.js
```

## Accounts, rights and the API

The program has one **main account** with every right. Its username and a hash of its password are fixed in the code (`access.js`,
sealed by `seal.js`): the program has **no way to change them**, not from the website, the settings, the API or the desktop app, and
**it does not start if those files are missing or altered**. There is no "forgot password".

There is also a simple **start account** for setting the server up: username `admin`, start password `admin-start-123` (it only works from
your own network, and the main account can change or remove it under Beheer). While no other account exists it may create accounts;
as soon as one exists it becomes an **emergency account** that can only see and change the status.

The main account also has a **Systeem** tab that nobody else has (and that can't be given to anyone): maintenance mode, which networks
may log in, session lengths, login-attempt limits, automatic deletion of old visitor requests, nightly backups (download / restore),
an emergency stop (*Noodstop*) and a danger zone.

**Screen lock:** the *Vergrendel* button in the header locks the control panel at once. Set your own 6-digit code under your name (*Schermcode*; it asks for your password). While locked the server refuses everything for that login (also on other devices using it, and the API) until the code is entered; 5 wrong codes log you out. Locked panels don't show visitor pop-ups. In the desktop app the lock also takes over the whole computer screen (full screen, on top of everything, visible on every desktop/Space, other monitors black) and quitting is disabled until you unlock.

**Profiles for visitors:** under *Wie ben je?* a visitor can make a profile (username, name, e-mail). After that one tap is enough for every question, and the answer can also be mailed. On a visitor's own phone (`/visit`) the profile is remembered; the door screen never remembers anyone. Profiles show up in *Instellingen → Personen* marked "Zelf aangemaakt"; you can edit or delete them there. Limit: 5 new profiles per hour per device.

On the login screen **Onthoud mij** keeps you logged in longer (set under Systeem). In the desktop app your login can be stored **encrypted
by your computer's own secure storage** (Keychain on macOS, Credential Vault on Windows, the keyring on Linux), so the app signs in by itself;
logging out forgets it. A password is never written anywhere in plain text.

The **Beheer** tab (also for people you give the rights):
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

## Locking the mouse to the door monitor
*Instellingen → Venster en sneltoetsen → Muis vergrendelen* (door screen, desktop app): the mouse pointer cannot leave the door monitor and every other monitor goes black.
macOS and Windows keep the pointer on the monitor; on Linux only the other monitors are blacked out. If the app ever stops, the helper releases the pointer by itself within five seconds.
The settings window (Ctrl/Cmd + Shift + S) and quitting (Ctrl/Cmd + Shift + Q) always work from the keyboard.
Emergency exit from any program: **Ctrl/Cmd + Alt + Shift + M** lets go of the mouse (press again to lock it again).

## Changing the account or the server (IP) in every app
- **iPhone / iPad:** the person icon next to *Live* on the Status screen (and *Instellingen → Account en server wijzigen…*) opens **Account en server**: change the server address, log in with another account, reconnect, or forget everything. If the server can't be reached an orange notice on the Status screen opens the same screen.
- **Desktop app (Windows, macOS, Linux):** in the control panel click your name → **Account wisselen** or **Server of IP wijzigen…**; the login screen has **Server, IP of account wijzigen**; and while the app is still "Verbinden met de deurserver…" that page has the same button. In *Instellingen* there is **Andere account gebruiken**.
- **Door screen in the desktop app:** click five times quickly in the top-left corner to open the settings (invisible to visitors); Ctrl/Cmd + Shift + S still works.

## Quality
`npm test` runs 29 automatic tests (accounts and rights, the screen lock, visitors and profiles, design texts/colours/layout/blocks, safe saving and recovery, the live connection, the updater). They run on Windows, macOS and Linux before every release.
The server also sends security headers, only lets its own pages be shown in a frame, and saves the very last change even when it is stopped at once.

## Updates and safe settings
- **Updater (desktop app):** the app looks for a newer version about once every 12 hours (switch off in *Instellingen → Updates*) and shows a notice plus *Update naar …* in the tray icon. It downloads the right installer for your computer (`.pkg`, `.exe`, `.AppImage`/`.deb`) to *Downloads* and opens it only when you say *Installeren*. **Instellingen → Updates → Nu controleren** checks right away.
  If the repository is private, give the app a read-only GitHub token once (*Privé-opslagplaats?*); it is stored encrypted by your computer's own secure storage.
- **Your settings survive an update:** they live outside the app (settings of this computer and the server's data). Before a new version starts for the first time the server makes a backup (`…_voor-update.json`).
- **Safe saving:** every save goes to a temporary file first and the previous good copy is kept (`.bak`). If a settings file is ever damaged, the program restores the last good copy or the newest backup instead of starting empty, and keeps the damaged file next to it.
- The iPhone/iPad app can't update itself: install the new version through Xcode (press ▶ again).

## The iPhone / iPad apps (a real native app)
The iPhone/iPad app is written in SwiftUI (no web page inside). It has tabs **Status · Bezoekers · Beheer · Instellingen**:
- **Status** — a big status card, the three big buttons (Open / Gesloten / Bezet), how long (15 min, 30 min, 1 uur, 2 uur, until a time, no end), quick *+15 / +30 / +1 uur*, back to opening hours, end *Bezet*, your message on the door, switches for doorbell / book a time / question / reasons / opening hours / night dimming, and planning *Bezet*.
- **Bezoekers** — the inbox with swipe-to-finish, quick replies, confirm appointments, a badge with the number of new visitors.
- **Beheer** — server and account info, people, users, activity log, back-up, emergency stop, and the full web panel (Ontwerp, texts, layout) one tap away.
- **Instellingen** — about 25 switches: haptics, sounds, notifications, Face ID and how soon it locks, confirmations, which cards show on the front screen, your own quick durations, large buttons, appearance, keep the screen awake, and more.
- An iPad or iPhone can also be the **door screen** (first start: *Deurscherm*).

**Two apps:** *Deur Beheer* (normal) and *Deur Dev* (developer, installs next to it) with an extra **Ontwikkelaar** tab: live events, raw server data, an API console, test notifications and haptics, environment info. In the normal app, tap *Versie* seven times under Instellingen to switch the developer tab on.
Install either with one command (phone connected with a cable): `cd ios && ./install.sh --team YOURTEAMID` or `./install.sh dev --team YOURTEAMID`; `./install.sh --sim dev` uses the simulator.

## Design: make the door screen yours (*Ontwerp* tab)
Control panel → **Ontwerp** (needs the settings right):
- **Teksten** — every word on the door screen and in the visitor steps can be changed: the title above the buttons (standard: *Niet kloppen*), the buttons, the countdown sentences, the questions, the messages. Leave a field empty for the standard text.
- **Kleuren** — your own colour for *Open*, *Gesloten* and *Bezet*.
- **Eigen onderdelen** — add your own text (size, colour, bold) or a logo/picture (up to 12 items). They appear on the screen and are moved like everything else.
- **Indeling** — drag anything to another place, resize it or hide it (see below). Each screen type (vertical, horizontal, phone) has its own layout.
Changes appear on every door screen at once after *Opslaan*.
The **Indeling** card shows a live preview of the door screen (vertical, horizontal, phone): drag the parts right there, then press *Opslaan* in the blue bar.

## Moving things around (*Indeling aanpassen*)
If something sits in the wrong place, you can move it yourself: control panel → *Instellingen → Scherm → Indeling*, or on the door screen itself **Ctrl/Cmd + Shift + E**
(or add `?edit=1` to the address). Log in, then drag the parts of the screen (status, the line with the time, your message, the three buttons, …) where you want
them; arrow keys move precisely, **+ / −** resize, *Verbergen* hides a part. *Opslaan* puts it on every door screen at once.
Vertical, horizontal and the phone page each have their own layout. The normal screen can never be moved by accident: only the edit mode lets you drag, and it needs a login with the settings right.

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
