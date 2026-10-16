# Beveiliging

Dit programma draait in je eigen netwerk, maar moet ook een aanval kunnen weerstaan. Hieronder staat wat er is beschermd, hoe het is getest, en wat jij moet doen.

## Wat is beschermd
| Aanval | Bescherming |
|---|---|
| Overspoelen met verzoeken (DDoS) | Elk apparaat heeft een emmer verzoeken die zich steeds vult. Een stoot (een pagina laden) mag, een stroom krijgt “429 rustig aan”. Wie blijft doorgaan wordt tien minuten geblokkeerd, vóór er iets anders gebeurt, en jij krijgt een waarschuwing. Uitzetten kan in Systeem → Toegang → Aanvalsbeveiliging (niet doen). |
| Trage aanvallen (slowloris) | Een verzoek moet binnen 15 seconden compleet binnen zijn, anders gaat de verbinding dicht. |
| Te veel live-verbindingen | Maximaal 30 open live-verbindingen per apparaat. |
| Wachtwoorden raden | Na 10 foute pogingen vanaf één apparaat een blokkade (instelbaar); bovendien wordt het antwoord voor één account trager naarmate er vanaf meer plekken wordt geraden; bij 25 pogingen krijg je een waarschuwing. |
| Bekend startwachtwoord | Het startaccount `admin` heeft per installatie een willekeurig wachtwoord. Oude installaties krijgen er bij de update een. |
| Zwakke wachtwoorden | De meest gebruikte wachtwoorden worden voor nieuwe accounts geweigerd. |
| Scripts in pagina’s (XSS) en inpakken in een frame | Strenge Content-Security-Policy: alleen eigen scripts, niets van buiten, niet in een frame, geen plug-ins. |
| Gif in de JSON (prototype pollution) | Sleutels als `__proto__` en `constructor` worden weggehaald. |
| Bestanden buiten de map lezen | Het pad wordt gecontroleerd; 10 varianten zijn getest. |
| Informatie lekken in foutmeldingen | Interne fouten krijgen een algemene melding en komen alleen in het logboek. |
| Het netwerk laten aftasten via de server (SSRF) | Het camerabeeld geeft alleen afbeeldingen door; webhook-, slot- en camera-adressen mogen niet naar het cloud-“metadata”-adres. |
| Een gemanipuleerde update | De updater controleert elke download op de SHA-256-controlesom van de release (`SHA256SUMS.txt`) en gebruikt hem anders niet. |
| Een link die een ander programma start | De desktop-app opent alleen http- en https-adressen. |
| Rechten omzeilen | Elke beschermde route weigert een account dat alleen mag kijken; dit wordt bij elke bouw getest voor alle routes. |
| Geheimen in het bestand met gegevens | Wachtwoorden en sleutels (e-mail, meldingen, back-upwachtwoord, tweestapssleutels, agendalink) staan versleuteld (AES-256-GCM) op de schijf; de sleutel staat apart in `secret.key`. |
| Alleen een wachtwoord is genoeg | Tweestapsverificatie met een code uit een app (RFC 6238) of een herstelcode; een code werkt maar één keer; het hoofdaccount kan het verplicht stellen voor zichzelf of voor iedereen met veel rechten. |
| Wachtwoord vergeten of uitgelekt | Passkeys: inloggen met vingerafdruk, gezicht of toestelcode (WebAuthn, alleen met https en een naam in plaats van een IP-adres). |
| Een onbekend apparaat dat inlogt | Elke gebruiker ziet de eigen apparaten en kan ze uitloggen; een nieuw apparaat geeft een melding. |
| Het logboek aanpassen | Elke regel is aan de vorige vastgemaakt (SHA-256-ketting); je kunt het controleren en exporteren, en een gewijzigde regel wordt gemeld. |
| Een back-up die in verkeerde handen komt | Back-ups kunnen met een wachtwoord worden versleuteld (`.sbk`) en automatisch een tweede kopie in een andere map krijgen. |
| Afluisteren op het netwerk | Https met een eigen certificaat-autoriteit (geen domein nodig). De apps vragen één keer of je de vingerafdruk vertrouwt (zoals bij SSH) en accepteren daarna alleen dat certificaat. |
| Scripts van binnenuit (XSS) | De pagina’s staan alleen eigen scripts en stijlen toe die in het bestand zelf staan, herkend aan hun vingerafdruk (geen `unsafe-inline` voor scripts). |
| Een rol te lang laten hebben | Tijdelijke extra rechten die vanzelf stoppen (voor een invaller). |
| Handmatig blokkeren | Een blokkeerlijst met instelbare aanvalsgrenzen en het opheffen van blokkades, in het paneel en de apps. |
| Een crash of vol geheugen | Fouten stoppen de server niet, worden gemeld, en geheugen wordt opgeruimd. |

## Beveiligingsscore
Bij Beveiliging in het paneel (en in de apps) staat een score van 0 tot 100 met per punt wat er mist en hoe je het oplost: startaccount, tweestapsverificatie, https, versleutelde back-ups, aanvalsbeveiliging, logboek en sleutels.

## Hoe het getest is
`tests/security.test.js` valt de eigen server aan met bekende technieken en moet elke keer slagen. De test staat bij de rest in `npm test` en draait ook in de automatische bouw.

## Wat je zelf moet doen
- Zet de server achter https als hij buiten je netwerk bereikbaar is (bijv. via Cloudflare Tunnel of een omgekeerde proxy), en zet dan `TRUST_PROXY=1` zodat het echte adres van bezoekers wordt gebruikt (anders zien alle bezoekers eruit als één adres en kan de aanvalsbeveiliging niets uitrichten).
- Verander het startwachtwoord zodra je binnen bent, of haal het account weg.
- Geef API-sleutels alleen de rechten die ze nodig hebben (zie docs/APPARATEN.md). Een gezicht opent de deur nooit.
- Zet “Waarschuwingen” aan en test ze, zodat je het hoort als er iets mis is.

## Een lek melden
Mail of bel de beheerder van deze installatie. Beschrijf wat je zag; probeer niet verder te gaan dan nodig is.

## Bekende grenzen
- De apps zijn niet ondertekend door Apple of Microsoft (dat kost geld per jaar); controleer downloads daarom aan de hand van `SHA256SUMS.txt` bij de release.
- De live-verbinding stuurt de sessiesleutel als deel van het adres mee (de browser kan geen koptekst toevoegen). Zet daarom https aan buiten je eigen netwerk. Het adres komt niet in het logboek van de server.
- Een aanval vanaf heel veel verschillende adressen tegelijk (een echte DDoS van buiten) kan alleen een voorgeschakelde dienst zoals Cloudflare tegenhouden; de beveiliging hier voorkomt dat één apparaat de server platlegt.
