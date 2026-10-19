# Plan voor versie 3.5.0-beta.12: 15 gemak, 15 functies, 15 schermverbeteringen

Aanpak: eerst de server (met tests), dan het web-paneel en het deurscherm, dan de apps (Mac/iPhone/iPad, Windows/Linux, desktop-app). Elke stap wordt getest voor de volgende begint. Wat niet getest kan worden, staat in het verslag.

## A. Gemak (15)
| # | Wat | Waar | Hoe |
|---|---|---|---|
| A1 | Waarschuwing bij weggaan met niet-opgeslagen wijzigingen | paneel | `beforeunload` als de balk "Alles opslaan" open staat |
| A2 | ⌘/Ctrl+S slaat alles op | paneel | toets opent dezelfde actie als de balk |
| A3 | Kaarten onthouden of ze dicht stonden | paneel | stand per kaart in `localStorage` |
| A4 | Kopieerknoppen bij adressen (widget-code, status, poster, paneel) | paneel | bestaande `copyBtn` |
| A5 | Wat je laatst deed in het paneel blijft na verversen (inbox-filter, zoekterm) | paneel | `localStorage` |
| A6 | Adresbalk volgt de pagina (`#systeem`), terugknop werkt | paneel | hash en `hashchange` |
| A7 | Ctrl/⌘+Enter verstuurt een antwoord | paneel | toets in het antwoordveld |
| A8 | Zoekveld in het logboek | paneel | filter op de regels |
| A9 | Afdrukken van het paneel zonder menu en knoppen | paneel | `@media print` |
| A10 | "Opgeslagen om 17:05" in de melding | paneel | tijd in de toast |
| A11 | Waarschuwing als de klok van de server afwijkt | server + paneel | `serverTime` tegen de browserklok; regel in de checklist |
| A12 | Test de bel (zonder verzoek te maken) | server + paneel + apps | `POST /api/bell/test` laat alle schermen bellen |
| A13 | `{naam}` in antwoorden wordt de naam van de bezoeker | server | vervangen bij het versturen |
| A14 | Aantal wachtende bezoekers op het deurscherm (optie) | server + deurscherm | alleen een getal, geen namen |
| A15 | Datum "laatst ingelogd" en eigen apparaten korter uitleggen | paneel | bestaande gegevens tonen |

## B. Functies (15)
| # | Wat | Waar | Hoe |
|---|---|---|---|
| B1 | Ster op een verzoek, filter "met ster" | server + paneel + apps | `starred` + route |
| B2 | Eigen notitie bij een verzoek (alleen voor jou) | server + paneel + apps | `note` + route |
| B3 | "Terugkerende bezoeker (3e keer)" bij een verzoek | server + paneel + apps | telling per cookie-nummer |
| B4 | Nieuwe pincode voor een persoon | server + paneel | `POST /api/people/pin` |
| B5 | Personenlijst als Excel-bestand | server + paneel | CSV |
| B6 | Statistiek als Excel-bestand | server + paneel | CSV per dag |
| B7 | Statistiek via de API (`/api/v1/stats`) | server | alias met sleutel |
| B8 | Bezet-blokken die elke week terugkomen | server + paneel | `repeat: weekly` |
| B9 | Het deurscherm in het Engels (taalkeuze) | server + deurscherm | Engelse standaardteksten, `nl`/`en` |
| B10 | Bezoekerspagina als app op het beginscherm | server | `/visit.webmanifest` |
| B11 | Afspraak toevoegen aan de agenda (`.ics`) na het boeken | bezoekerspagina | bestand in de browser gemaakt |
| B12 | Drukte per uur in de apps | apps | `/api/stats` + grafiek |
| B13 | Eerste-keer-checklist in de apps | apps | `/api/checklist` |
| B14 | Test de bel vanuit de apps | apps | `POST /api/bell/test` |
| B15 | Vandaag/gisteren-vergelijking in de Drukte-kaart | paneel | getallen uit `byDay` |

## C. Schermen: macOS, iOS, Windows/Linux, desktop-app, web (15)
| # | Wat | Platform |
|---|---|---|
| C1 | Grafiek "Drukte per uur" op de pagina Status | iPhone, iPad, Mac |
| C2 | Checklist "Eerste keer instellen" met "Regelen" | iPhone, iPad, Mac |
| C3 | Knop "Test de bel" | iPhone, iPad, Mac |
| C4 | Ster en notitie bij een verzoek, badge "terugkerend" | iPhone, iPad, Mac |
| C5 | Mac: aantal open verzoeken op het menubalk-icoon | Mac |
| C6 | Mac: sneltoetsen ⌘4 en ⌘5 naar Bezoekers en Instellingen | Mac |
| C7 | Windows/Linux: samenvatting "Drukte" op de statuspagina | Avalonia |
| C8 | Windows/Linux: knop "Test de bel" | Avalonia |
| C9 | Windows/Linux: sneltoetsen O, G, B | Avalonia |
| C10 | Desktop-app: menu "Pagina's" (poster, widget, testpagina, privacy) | Electron |
| C11 | Desktop-app: sneltoets voor "Test de bel" | Electron |
| C12 | Paneel: ster-knop en notitieveld in het verzoek | web |
| C13 | Paneel: knop "Nieuwe pincode" bij een persoon | web |
| C14 | Paneel: knop "Test de bel" op Status en banner bij klokafwijking | web |
| C15 | Deurscherm: wachtenden-teller en Engelse taal | web |

## Volgorde en controle
1. Server: routes en velden, met tests (`tests/beta12.test.js`).
2. Paneel en deurscherm: bouwen en in de browser bekijken.
3. Apps: Swift (Mac-schema bouwt lokaal), Avalonia (bouwt lokaal met de .NET-SDK), Electron (syntaxis en test).
4. Alle tests, daarna uitgave `v3.5.0-beta.12`.
Alleen wat echt gebouwd en gecontroleerd is, telt in het verslag mee.

## Uitkomst (wat echt gebouwd en gecontroleerd is)
- **Gemak (15):** A1 waarschuwing bij weggaan, A2 Ctrl/⌘+S, A4 kopieerknoppen, A5 inbox-filter blijft, A6 adresbalk en terugknop, A7 knop {naam} bij een antwoord, A8 zoeken in het logboek, A9 afdrukken, A10 "Opgeslagen om …", A11 klokwaarschuwing, A12 test de bel, A13 {naam} in antwoorden, A14 wachtenden op het deurscherm, plus de sneltoets R (antwoord typen) en de status in de titel van het tabblad. (A3 bestond al, A15 is vervangen door deze twee.)
- **Functies (15):** B1 t/m B15 zoals in de tabel, allemaal gebouwd.
- **Schermen:** C1 grafiek Drukte, C2 checklist, C3 test de bel, C4 ster/notitie/terugkerend (iPhone, iPad, Mac); C6 ⌘1–⌘5 (Mac); C7 Drukte, C8 test de bel, C9 sneltoetsen O/G/B, extra: checklist (Windows/Linux); C10 menu Pagina's (desktop-app); C12 ster en notitie, C13 pincode-knop, C14 test de bel en klokbanner, C15 wachtenden en Engels (web). C5 bestond al (het menubalk-icoon toont al het aantal), C11 is niet gebouwd. De pincode wordt in de apps niet meer getoond ("Herkend met pincode").
- **Getest:** 199 tests, de testpagina, het Mac-schema en het iOS-schema bouwen. **Niet lokaal gebouwd:** de Windows/Linux-app (de .NET-SDK staat niet op deze Mac; GitHub bouwt en test haar bij de uitgave).
