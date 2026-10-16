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
| Windows | `…-windows-setup.exe` (of `…-windows-portable.exe`: zonder installeren, bv. vanaf een usb-stick) |
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

There is also a simple **start account** for setting the server up: username `admin`, start password **made up at random for every installation** (shown once in the console, kept in `data/starter-password.txt`, and on the start screen of the Linux image; it only works from
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

## Moderation and more (version 2.4)
- **Moderation** (*Instellingen → Moderatie*): a filter for bad words (built-in list plus your own words; the word is hidden with stars, only marked, or the message is refused), block a visitor from *Bezoekers → Modereren* (for an hour, a day, a week or for ever, by profile or by phone), a limit per phone per hour, new profiles approved by you first, and deleting messages. The door screen itself is shared by everybody and can never be blocked or limited. Behind a tunnel, set `TRUST_PROXY=1` so the server sees each phone's own address.
- **Receptionist role:** sees and answers visitors, nothing else.
- **Callback requests** (*Terugbellen*): an extra button on the door screen (off by default, switch on under *Bezoekers*); visitors leave a name, a number and when it suits.
- **Absence mode** (*Instellingen → Afwezig*): closed until a date, with your own message.
- **Own ringtones** (*Ontwerp → Beltonen*): five built-in sounds, or upload your own (mp3/wav/ogg/m4a, up to 400 kB).
- **Light and dark by the clock**, **weather** (Open-Meteo, free, no key) and a **QR code** that opens the visitor page on the visitor's own phone (*Ontwerp → Extra's op het scherm*).
- **Evening summary by mail** (*Instellingen → E-mail*), and a one-click topic maker for phone notifications through ntfy.

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

## Versie 2.5.1 — energie, kleuren, vinden en downloaden

Alles hieronder staat standaard **uit** en kost niets.

- **Energie (Beheer → Energie, recht `power`, standaard alleen de eigenaar):** per dag kiezen wanneer het deurscherm uit/aan gaat en wanneer de computer slaapt, in winterslaap gaat of uitgaat. Het deurscherm toont vooraf een aftelling. Wakker worden: Windows via een geplande taak (WakeToRun, eenmalig “Toepassen” als beheerder) of de BIOS-wekker; macOS via `pmset`; Linux via `rtcwake`; een Raspberry Pi heeft geen klok en kan niet zelf opstarten — gebruik een slimme stekker met timer of een RTC-module. Wake-on-LAN kan andere computers aanzetten.
- **Kleurthema’s (Ontwerp):** één knop voor het hele uiterlijk (Standaard, Blauw, Oceaan, Paars, Roze, Zonsondergang, Zwart-wit, Hoog contrast, Kleurenblind-vriendelijk) plus een eigen accentkleur. Elk apparaat (web, iPhone, bureaublad) kan daarnaast zijn eigen uiterlijk kiezen.
- **Server vinden:** apps zoeken servers in het netwerk zelf (UDP 41234; uit te zetten met `DOOR_DISCOVERY=off`).
- **Downloadpagina:** Ontwerp → “Downloadpagina” zet `/get` aan; zet de bestanden in `data/downloads`.
- **App-icoon:** dashboard-icoon; op iPhone kiezen tussen donker, licht en blauw (Instellingen → Weergave).
- **Automatisch updaten bij opstarten:** in de instellingen van de desktop-app staat “Update vanzelf installeren zodra de pc opstart” (uit tot je hem aanzet). Twintig seconden na het starten kijkt de app op GitHub; is er een nieuwere versie dan installeert Windows hem stil en start de app opnieuw, en vervangt een Linux-AppImage zichzelf. Een Mac-`.pkg` en een Linux-`.deb` vragen een beheerderswachtwoord, dus daar blijft het bij de vraag “Installeren?”. Gegevens blijven bewaard.
- **Eigen Linux (ISO):** zie [linux-iso/README.md](linux-iso/README.md): een usb-stick waarvan een pc opstart met server en deurscherm, zonder installatie.

## Versie 2.6.0 — koppelingen
- **Microcontrollers (ESP32, Raspberry Pi Pico W, …):** melden knoppen en sensoren en lezen de deurstatus (met kleur voor een ledje). Voorbeeldcode in `docs/firmware`.
- **Slot en RFID:** RFID-kaartjes met naam, dagen en tijden; de server roept het webadres van jullie slot aan zodra dat bekend is. Tot die tijd gebeurt er niets.
- **Camera’s en herkenning:** een camera-AI meldt wie er voor de deur staat; alleen mensen met toestemming, zonder beelden te bewaren. Een gezicht opent de deur nooit.
- **Regels:** “als dit gebeurt, doe dat” tussen apparaten, tags, camera en deurstatus.
- Alles staat uit tot je het aanzet; zie [docs/APPARATEN.md](docs/APPARATEN.md).
- **Eigen Linux** nu ook voor 32-bits (i386) en ARM (arm64), naast amd64.
- **Controle:** een lijstje bovenaan Instellingen dat zegt wat al goed staat en wat je nog kunt doen.
- **Opstarten:** kies wat de deur laat zien na een herstart (openingstijden, open, gesloten of bezet), en in de desktop-app: even wachten na het opstarten en het bedieningspaneel alleen in het icoon bij de klok starten.
- **RFID:** kaartjes en sleutelhangers werken naast NFC (`POST /api/door/rfid`).
- **ISO uitproberen zonder tweede computer:** zie `linux-iso/README.md` (`test-vm.sh`, VirtualBox, UTM).

## Versie 2.7.1 — eigen beheer-apps (geen webpagina)
Voor elk systeem is er nu een echt programma dat verbindt met de deurserver. Ze doen hetzelfde (status, bezoekers, beheer met Energie en Controle, account), maar zien eruit en voelen aan als een app van dat systeem.

| Systeem | Bestand bij de release | Wat het is |
|---|---|---|
| **Mac** | `Saga-Techbox-Beheer-Mac.dmg` | SwiftUI-app met zijbalk, menubalk-icoon dat de status toont (kleur + rode stip bij nieuwe bezoekers), sneltoetsen ⌥⌘1/2/3 voor Open/Gesloten/Bezet, Instellingen op ⌘, en openen bij inloggen |
| **Windows** | `Saga-Techbox-Beheer-Windows-x64.zip` (of `-Windows-ARM.zip`) | Een los programma (.exe), blijft in het systeemvak, inlog versleuteld met je Windows-account |
| **Linux** | `Saga-Techbox-Beheer-Linux-x64.tar.gz` (of `-Linux-ARM64`) | Zelfde programma; uitpakken en `./install.sh` (zet het in je eigen map, met menu-snelkoppeling) |
| **iPhone en iPad** | `Saga-Techbox-Beheer-iOS-unsigned.ipa` | Bestond al; heeft nu ook de Controle-lijst |

De Electron-app blijft bestaan voor wie de server op die computer wil draaien of een deurscherm wil maken. De beheer-apps zijn alleen het bedieningspaneel.

**Eerste keer starten:** de apps zijn niet door Apple of Microsoft ondertekend (dat kost geld per jaar). Mac: rechtsklik op de app → Open (of `xattr -dr com.apple.quarantine "/Applications/Deur Beheer.app"`). Windows: “Meer info” → “Toch uitvoeren”. Zoek de server met de knop “Zoeken” of typ het adres.

## Versie 2.8.0 — meer dan het webpaneel
Alle beheer-apps (Mac, Windows, Linux) hebben dingen die het webpaneel niet heeft, en een eigen Dev-versie:

- **Licht, donker of zoals het systeem**, plus een eigen accentkleur (groen, blauw, paars, roze, oranje, lucht, of volg de server).
- **Snelle acties:** eigen knoppen zoals “Lunch · 30 min · Bezet · ‘Even lunch’”. Eén klik; ze staan op de Status-pagina en in het menu van het icoon in de menubalk of bij de klok. Je maakt ze zelf in Instellingen.
- **Vandaag in cijfers:** bezoekers, wachtend, aangebeld, gemiddelde antwoordtijd.
- **Bezoekers doorzoeken en exporteren** naar CSV.
- **Stille uren:** geen geluid of melding in uren die je kiest (Mac en Windows/Linux).
- **Mac:** menubalk-icoon met kleur en rode stip, sneltoetsen ⌥⌘1/2/3.
- **Dev-versies** (`Saga-Techbox-Dev-Mac.dmg`, `Saga-Techbox-Dev-Windows-….zip`, `Saga-Techbox-Dev-Linux-….tar.gz`): installeren naast de gewone app en hebben een Ontwikkelaar-pagina met een **API-console**, de ruwe gegevens van de server, een gebeurtenissenlog en verbindingsinformatie.

## Versie 2.9.0 — nagekeken en waarschuwingen
Het hele programma is doorgelopen op fouten, trage plekken en dingen die kunnen stukgaan. Gevonden en opgelost:

- **Waarschuwingen aan jou:** gaat er iets mis, dan krijg je een melding (telefoon via ntfy, of e-mail, wat je al hebt ingesteld) en het staat bovenaan in de Controle-lijst, ook in de apps. Het gaat om: opslaan lukt niet, schijf bijna vol, veel geheugen, een overbelaste computer, een fout in de server, en (als je dat aanzet) “er is al X minuten geen deurscherm verbonden”. Zodra het weer goed gaat, krijg je een “opgelost”-bericht. Instellingen → Waarschuwingen heeft een knop om het te proberen.
- **De server stopt niet meer bij één fout.** Voorheen kon één onverwachte fout in een timer de hele deurserver laten stoppen; nu wordt hij gemeld en gaat het door (pas bij vele fouten per minuut stopt hij schoon, zodat hij kan herstarten).
- **Geheugenlek weggehaald:** de lijsten met bezoek- en inlogpogingen per adres werden nooit opgeruimd en groeiden langzaam; nu wel.
- **Sneller:** opslaan schrijft compact en maakt de reserve-kopie hooguit eens per minuut; de pagina’s worden één keer gecomprimeerd en daarna alleen opnieuw gestuurd als ze veranderd zijn (veel sneller over wifi); de live-berichten worden één keer klaargemaakt in plaats van per scherm; een scherm dat niet bijblijft kost de server geen geheugen meer.
- **Schema:** “scherm aan” gebeurt nu ook als de computer een paar minuten te laat wakker werd (tot een half uur); uitzetten blijft nooit te laat.
- **Veiliger:** het camerabeeld-adres geeft alleen afbeeldingen door, zodat het geen manier is om andere pagina’s in het netwerk te lezen.
- **Apps:** ze melden een verbinding die langer dan anderhalve minuut weg is, en nieuwe waarschuwingen van de server. De desktop-app (Electron) schrijft crashes naar een logbestand in plaats van een foutvenster te tonen op een deurscherm, en laadt een bevroren pagina na 20 seconden opnieuw.

## Versie 3.0.0 — beveiliging
Zie [SECURITY.md](SECURITY.md): bekende aanvallen zijn op de eigen server losgelaten en worden nu tegengehouden, met aanvalsbeveiliging (overspoelen, trage aanvallen, wachtwoorden raden, te veel verbindingen), een strenge Content-Security-Policy, een willekeurig startwachtwoord per installatie (het bekende standaardwachtwoord is weg), controlesommen op updates en een test voor alle routes. Je krijgt een waarschuwing als iemand de server probeert te overspoelen.

## Versie 3.1.0 — iPhone en iPad op hetzelfde niveau
De iPhone- en iPad-app hebben nu ook: **snelle acties** (eigen knoppen als “Lunch · 30 min · Bezet”, te maken in Instellingen), **vandaag in cijfers** op de Status-pagina, **zoeken in bezoekers**, **stille uren**, en **waarschuwingen**: een nieuwe waarschuwing van de server of een server die langer dan anderhalve minuut weg is, verschijnt als bericht (en als melding als de app op de achtergrond nog leeft). Verder is de map met bouwbestanden van de iPhone-app uit de opslagplaats gehaald (die maakte hem onnodig groot).

## Versie 3.2.0 — gecontroleerd op echte systemen
- **Zelftest op Windows en Linux:** bij elke bouw start GitHub de echte Windows- en Linux-app (en de Dev-versies) op een echte Windows- en Linux-machine, laat ze inloggen op een echte server, de status veranderen en terugzetten, en maakt er een schermafbeelding van. Slaagt dat niet, dan komt de versie niet vrij.
- **Echte systeemmeldingen** in de Windows- en Linux-app (bezoekers, waarschuwingen, verbinding kwijt), met respect voor de stille uren.
- **Handleiding in gewone taal** op `/help` (en met een knop in de Controle-kaart en op het startscherm): beginnen, elke dag, bezoekers, wat te doen als er iets misgaat, veilig houden.
- **Toegankelijkheid:** schermlezers lezen de status van het deurscherm voor zodra die verandert.

## Versie 3.3.0 (developer beta) — het bezoekersformulier en inloggen met een QR-code
**Dit is een voorlopige versie voor ontwikkelaars (een “pre-release” op GitHub).** De gewone updater biedt hem niet aan: alleen wie hem zelf downloadt, krijgt hem. Een gewone versie volgt pas als dit goed werkt.

- **Bezoekersformulier:** per knop (aanbellen, reden, vraagje, tijd boeken, terugbellen) bepaal je of **naam** en **e-mailadres** niet gevraagd worden, leeg mogen blijven, of **verplicht** zijn (en het telefoonnummer bij terugbellen). Daarnaast: eerst **toestemming** laten aanvinken met je eigen tekst, een korte privacytekst, de maximale lengte van een bericht, de wachttijd tussen verzoeken en tussen keren aanbellen, en een eigen tekst na het versturen. De regels gelden op het deurscherm én op de bezoekerspagina, en de server controleert ze ook zelf (je kunt ze dus niet omzeilen).
- **Overal dezelfde instellingen:** de server beschrijft deze instellingen; het bedieningspaneel, de Mac-, iPhone-, iPad-, Windows- en Linux-apps tekenen ze zelf. Een nieuwe optie verschijnt dus overal tegelijk, zonder dat een app vernieuwd hoeft te worden.
- **Inloggen met een QR-code:** in het bedieningspaneel (“Inloggen op een ander apparaat”) maak je een code die twee minuten en één keer werkt. Scan hem met je telefoon of een andere computer en je bent ingelogd, ook buiten je eigen netwerk, zonder je wachtwoord te typen. Het inlogformulier is verder geschikt voor wachtwoordmanagers (iCloud-sleutelhanger, Chrome, 1Password), die het wachtwoord zelf invullen.
- **iPad:** een zijbalk in plaats van de tabbalk als er ruimte is.
- **Beta installeren:** download de bestanden bij de release `v3.3.0-beta.1` op GitHub (Releases → Pre-release). De Dev-apps zijn de voorgestelde manier om dit te proberen.

Wat nog ontbreekt: echte *passkeys* (een inlog met Face ID of Touch ID op het web). Die werken alleen op een veilige verbinding (https); op een gewoon adres in je eigen netwerk (`http://192.168…`) staat de browser dat niet toe. De QR-code is daarvoor het alternatief.
