# Hoe de app wordt bijgewerkt

## De vier stappen
1. **Jij kiest** welke ideeën je wilt (de pagina met 50 ideeën; Ja / Misschien / Nee).
2. **Claude bouwt in rondes** van 5 tot 8 ideeën. Eerst de kleine, dan de grotere. Wat niet getest kan worden zonder jouw apparaat, staat erbij.
3. **Alles wordt getest** voordat het uitkomt: de automatische tests (`npm test`, nu 32) en een build voor Windows, macOS, Linux en iPhone/iPad.
4. **Nieuwe versie op GitHub** (een tag `vX.Y.Z`). De computer-apps melden zelf "Update beschikbaar" (Instellingen → Updates). Voor de iPhone/iPad installeer je opnieuw (`ios/install.sh`, of AltStore ververst het zelf).

## Versienummers
- `X.Y.Z`: **Z** = kleine reparatie, **Y** = nieuwe functies, **X** = grote vernieuwing (zoals de echte iPhone-app in 2.0).
- Voor elke versie is er een bewaarpunt (`works-vNN`). Terugzetten: `./restore.sh works-vNN`.

## Voorstel voor de rondes (na jouw keuzes)
| Ronde | Inhoud | Doel |
|---|---|---|
| 1 | Alle "Ja"-ideeën met inspanning **klein** | Snel zichtbaar resultaat |
| 2 | Alle "Ja"-ideeën met inspanning **middel** | De meest gebruikte uitbreidingen |
| 3 | Alle "Ja"-ideeën met inspanning **groot** | De grote stappen, één voor één |
| 4 | "Misschien"-ideeën die je na ronde 1–3 nog wilt | Bijsturen |

## Wat een idee kan kosten
- **gratis**: alleen werk, geen extra dienst.
- **extra dienst**: een koppeling met een andere dienst (agenda, Slack, een belprovider). Soms met een eigen account of kosten daar.
- **betaald account**: alleen met het Apple Developer Program (99 dollar per jaar), bijvoorbeeld echte Apple-pushmeldingen of een app die een jaar blijft werken.

---

# Plan voor volgende week (op basis van jouw keuzes: 40 Ja, 10 Misschien)

Werkwijze: je stuurt **"Start dag N"**. Ik bouw die dag, draai de tests, zet de versie op GitHub en meld wat ik wel en niet kon testen. Elke dag is één versie.

| Dag | Versie | Wat er komt |
|---|---|---|
| **1 — Moderatie en snelle winsten** | 2.4 | Moderatie: filter voor scheldwoorden (markeren, verbergen of weigeren), bezoekers blokkeren, limiet per telefoon per uur, profielen eerst goedkeuren, berichten verwijderen. Daarnaast: receptionistenrol (34), donker en licht op een rooster (43), eigen beltonen (48), weer (02), QR-code voor je eigen telefoon (04), afwezigheidsmodus (06), terugbelverzoek (17), meldingen als de app dicht is, makkelijk ingesteld (19), avondsamenvatting per mail (24) |
| **2 — Deurscherm** | 2.5 | Agenda van vandaag (01), wachtrij (03), wisselende mededelingen (07), twee talen op het scherm (05), groot-lettermodus en voorlezen (09), bediening zonder aanraken met QR en NFC (10), dagelijkse kleine verrassing (49) |
| **3 — Bezoekersflow** | 2.6 | Afspraak met agenda-bijlage (13), vaste gasten (14), aanmelden bij binnenkomst (15), pakketjes registreren (16), foto bij de bel met toestemming (11), spraakbericht (12) |
| **4 — Slim doorsturen** | 2.7 | Doorsturen als jij niet reageert (21), Slack-, Teams- en Discord-berichten (22), als-dan-regels (30), aanwezigheidsbord voor een team (33), sms bij belangrijke bezoekers (23) |
| **5 — Inloggen, taal en overzicht** | 2.8 | Passkeys en Face ID op het web (36), grafieken en rapportage (37), eerste-keer-wizard (42), het paneel in meer talen (44), vragen vertalen (46), zoeken en samenvatten (47) |
| **6 — iPhone, iPad en Apple Watch** | 2.9 | Alles uit dag 1 tot 5 ook in de echte app, widgets en vergrendelscherm (29), Apple Watch (20), hulp voor AltStore (38) |
| **7 — Netwerk en afronding** | 2.10 | Server bereikbaar vanaf overal (41), werkt zonder internet (50), agenda bepaalt de status (25), gesprek in Zoom of Teams zet de deur op Bezet (28), alle tests opnieuw, bijgewerkte uitleg, daarna je "Misschien"-ideeën bekijken |

## Wat ik van jou nodig heb
| Voor dag | Wat | Verplicht? |
|---|---|---|
| 4 | Een Slack-, Teams- of Discord-webhook-adres (maak je zelf in die dienst, kost niets) | Alleen voor 22 |
| 4 | Een account bij een belprovider (bijvoorbeeld Twilio) voor sms | Alleen voor 23; kost geld per bericht |
| 5 | Een sleutel voor vertalen en samenvatten (AI of een vertaaldienst) | Alleen voor 46 en 47; kleine kosten |
| 6 | Xcode met het Apple Watch-onderdeel, en een Apple Watch om te proberen | Zonder dit kan ik 20 bouwen maar niet testen |
| 7 | Het geheime agenda-adres (ICS) van je Google-, Apple- of Outlook-agenda | Voor 25; makkelijker dan inloggen via de dienst |

## Eerlijk over risico's
- **Apple Watch (20) en widgets (29):** een gratis Apple-ID geeft ook hier 7 dagen. Echte pushmeldingen naar het scherm van de telefoon vragen een betaald account.
- **Foto en spraak (11, 12):** opslag van beeld en geluid van bezoekers vraagt toestemming en een bewaartermijn. Die bouw ik erin.
- **Zoom of Teams (28):** officiële koppeling vraagt inloggen via hun dienst. Mijn voorstel: de computer-app ziet dat microfoon of camera aan staat en zet de deur dan op Bezet.
- **Wat ik niet zelf kan proberen** (apparaten, accounts bij derden): noem ik bij elke versie.
