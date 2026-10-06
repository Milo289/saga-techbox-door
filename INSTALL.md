# Installeren — alleen voor jou

Alle installatiebestanden staan op de **Releases**-pagina van het privé-project (of onder *Actions → laatste run → Artifacts*).
Je hebt daar jouw GitHub-account voor nodig, dus alleen jij kunt ze downloaden.

**Je gebruikersnaam en wachtwoord** zijn die van het hoofdaccount. Ze staan niet in de bestanden (alleen een hash) en kunnen nergens worden gewijzigd.

## Windows
1. Download `Saga-Techbox-Deur-…-windows-setup.exe` en dubbelklik.
2. Windows toont *“Windows heeft uw pc beschermd”* omdat het programma geen betaald certificaat heeft: klik **Meer info → Toch uitvoeren**.
3. Kies in de app *Bedieningspaneel* of *Deurscherm*. De eerste keer vraagt de Windows-firewall of de app het netwerk op mag: kies **Toestaan** (anders kunnen andere apparaten niet verbinden).

## Mac
1. Download `…-mac-arm64.dmg` (Mac met Apple-chip: M1 en nieuwer) of `…-mac-x64.dmg` (Intel). Sleep de app naar *Programma’s*.
2. De eerste keer: **rechtsklik op de app → Open → Open**. Zegt macOS dat de app “beschadigd” is, voer dan één keer uit in Terminal:
   ```
   xattr -cr "/Applications/Saga Techbox Deur.app"
   ```

## Linux / Raspberry Pi
`…-linux-….AppImage`: maak uitvoerbaar (`chmod +x`) en start. Of installeer de `.deb` (`sudo apt install ./bestand.deb`).

## iPhone en iPad (alleen jouw eigen toestel)
`Saga-Techbox-Beheer-iOS-unsigned.ipa` is **niet ondertekend**: Apple laat alleen ondertekende apps toe, en ondertekenen kan alleen met jouw eigen Apple-account.
Dat doe je zelf, gratis:

**Optie A — met een Mac en Xcode (het eenvoudigst)**
1. Open `ios/DeurBeheer.xcodeproj` (maak hem eerst met `cd ios && xcodegen generate`, installeer xcodegen met `brew install xcodegen`).
2. Kies bij *Signing & Capabilities* jouw naam (gratis Apple-account) als *Team* en je iPhone als bestemming, en druk op ▶︎.
3. Op de iPhone: *Instellingen → Algemeen → VPN en apparaatbeheer →* vertrouw jezelf.
   (Met een gratis account moet je de app elke 7 dagen opnieuw installeren; met het betaalde Apple Developer-programma duurt het een jaar.)

**Optie B — zonder Xcode:** installeer de `.ipa` met **Sideloadly** of **AltStore** (log in met je Apple-ID; zij ondertekenen de app voor je).

Daarna: open de app, vul het adres van je deurserver (bijv. `192.168.1.50:8080`), je gebruikersnaam en je wachtwoord in. De app bewaart je inlog versleuteld in de Sleutelhanger van je iPhone en vergrendelt zich met Face ID.
