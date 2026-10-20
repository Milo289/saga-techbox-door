# Voortgang van het Bouwplan (keuze van de gebruiker)

Gekozen: alle onderdelen behalve B11 (update-handtekeningen). Uitbrengen als developer beta (pre-release).

Rondes (elk met tests en een eigen beta):
1. Server en beveiliging: B4 geheimen versleuteld, B6 logboek met ketting, B3 apparaten/sessies, B9 blokkeerlijst, B14 tijdelijke rechten, B2 tweestapsverificatie, B5 versleutelde back-ups, K6 herstarten, B1 beveiligingscontrole, K7 foutmeldingen
2. Https en passkeys: B7 (eigen certificaat-autoriteit), B8 passkeys, B10 strenge CSP
3. Webpaneel: W1–W10, K1, K5, plus de nieuwe beveiligingsschermen
4. Apple-apps en Windows/Linux-apps: A1–A13, B12, K1–K4, K8–K10, 2FA-login
5. Meer mogelijkheden: M1–M7, B13 (Linux-schijf), Proxmox-testscript

Status per onderdeel staat hieronder (bijwerken na elke ronde).



## Stand na ronde 1–5 (developer beta 3.4.0-beta.1)
Klaar en getest met automatische tests (server 150+ tests, 8 Swift-tests, Windows/Linux-rooktest in de bouw): A1–A7, A9–A13 (zie opmerkingen), B1–B10, B12–B14, W1–W10, K1–K10, M1–M7.
Opmerkingen:
- A8 (Spotlight/Opdrachten): de bestaande App Intents verschijnen in Spotlight; niets nieuws toegevoegd.
- A9 (meerdere vensters): Mac heeft ze via ⌘N; iPad staat nu aan in de app, maar is niet op een echte iPad geprobeerd.
- A10 (toegankelijkheid): labels bij de bezoekerslijst en grote onderdelen; niet gecontroleerd met VoiceOver.
- M3 (meerdere deuren): in de apps bij Servers met de status van elke deur; geen gecombineerd paneel op de server zelf.
- Passkeys zijn alleen getest met een nagebootste authenticator, nog niet met echte apparaten.
- B11 (update-handtekeningen) is bewust niet gedaan.

## beta.18 — server bijwerken vanuit het paneel
- Systeem → *Server bijwerken*: zoekt op GitHub naar een nieuwere versie (gewoon of ook developer betas), downloadt `Saga-Techbox-Server.tgz`, controleert de sha256, pakt uit in `<data>/app/<versie>`, maakt een back-up en herstart. `boot.js` start de nieuwste code; een versie die drie keer niet start wordt teruggedraaid.
- Linux-schijf: een lege tweede schijf wordt zelf als gegevensschijf (`saga-data`) gebruikt, zodat gegevens en updates een herstart overleven.
- Getest: eenheidstests (versies, kanalen, onveilige namen, controlesom, onvolledig bestand, boot.js terugdraaien), de routes en het paneel. NIET getest: een echte update tussen twee uitgaven (de eerste uitgave met het serverbestand is deze), de gegevensschijf op echte hardware (CI start hem wel in een virtuele machine).
- Nog geen ondertekening van uitgaven (B11): de controlesom beschermt alleen tegen een beschadigd bestand.

## 3.5.0-beta.1 — eerste public beta
- Opt-in: de desktop-app (Instellingen → Updates → "Ook public betas aanbieden") en de server (Systeem → Server bijwerken → "Ook developer betas") bieden betas alleen aan wie dat aanzet. Gewone gebruikers blijven op de laatste gewone versie (3.2.0) tot er een gewone uitgave komt.
- Een uitgave met een tag als `v3.5.0-beta.1` zet die versie nu ook in `package.json` tijdens de build, zodat server en app weten dat ze een beta zijn en de volgende beta als nieuwer zien.
- De updater van de desktop-app begrijpt nu betaversies (beta.10 is nieuwer dan beta.9, 3.5.0 nieuwer dan 3.5.0-beta.9).
- Niet getest: een echte update van de desktop-app naar een beta op Windows/Mac/Linux (alleen de vergelijkingen en de GitHub-aanroep in eenheidstests).

## 3.5.0-beta.3
- Nieuwe installaties bewaren bezoekersverzoeken 90 dagen (bestaande servers houden hun eigen instelling).
- "Eerste keer instellen": checklist op Status en Systeem (https, 2FA, passkey, back-upwachtwoord, bewaartermijn, gegevensschijf, back-uptest, meldingen, openingstijden) met een knop naar de juiste plek.
- Waarschuwingen: de server meldt na een onverwachte stop (stroom, vastgelopen VM, geen nette afsluiting) hoe lang hij weg was; mislukte automatische back-up; mislukte back-uptest.
- Back-up test: na elke nachtelijke back-up en met de knop "Test back-up" wordt de back-up geopend zoals bij een terugzetting (ontsleutelen, lezen, tellen) zonder de server aan te raken.
- iPhone/iPad/Mac-app: "Server bijwerken" in het beveiligingsscherm (zoeken, bijwerken). De desktop-app (Electron) toont het web-paneel en heeft dit dus al.
- Ondertekende uitgaven: elke uitgave krijgt een handtekening (Ed25519) op SHA256SUMS.txt en op de controlesom van het serverbestand. Server en desktop-app installeren alleen wat past bij de ingebouwde sleutel. De privésleutel staat alleen in het GitHub-geheim `RELEASE_SIGNING_KEY` en in een kopie op de computer van de maker (`~/.saga-release-key.pem`). Zonder geheim maakt de build geen uitgave.
- Niet getest: een echte update tussen twee ondertekende uitgaven, de uitvalmelding na een echte stroomuitval, het Apple-scherm op een echt apparaat (de Mac-app bouwt wel).

## 3.5.0-beta.6 — Weergave (Instellingen → Weergave)
Nieuw in het deurscherm, allemaal instelbaar en terug te zetten naar standaard: weergavemodi (standaard, alleen status, grote klok, planning, smalle balk, alleen kleur), lettertype (5), tekstgrootte, letterdikte, klok (digitaal/wijzerplaat/geen) met seconden en datum, animatie bij een nieuwe status (4), stijl van knoppen (4), hoeken (3), achtergrond (5), gekleurde rand (4), voortgangsbalk tot de volgende statuswijziging, symbolen aan/uit, planning onder de status, lopende tekst, vaste regel, schermbeveiliging bij geen aanraking, beeld verschuiven tegen inbranden, hoog contrast, animaties uit, en 7 kant-en-klare ontwerpen. Het paneel heeft daarnaast "Dit paneel op dit apparaat" (ruimte, tekstgrootte, accentkleur, geen animaties, contrast). De velden staan ook in "Alle instellingen" en in de developer-apps (via de beschrijving van de server).
Niet getest: een echt deurscherm op alle schermformaten (alleen smalle telefoon en een brede balk in de browser), de voortgangsbalk over een lange periode.

## 3.5.0-beta.7 — meer opties
Knoppen op de voorpagina: plaats (onder, boven, zijkant, zwevend), grootte, kolommen, soort (formulier, informatie, webadres, telefoon, wifi met QR-code), kleur, symbool, wanneer te zien. Deurscherm: wisselende berichten, aftellen naar een datum, groet, laatst bijgewerkt, flits bij aanbellen, scherm aan houden, status hardop, dagelijks verversen, statuspunt-stijl, uitlijning, gloed, marge, spiegelen. Server en paneel: bericht per datum, rustige uren, statistiek (Drukte), CSV-export, privacy zoeken en wissen, terugdraaien van een update, openbare status (/status.json, /badge.svg, /widget), poster (/poster), live voorbeeld, nieuws bij een update, sneltoetsen (O/G/B/?), instellingen uit en naar een bestand, aanbevolen instellingenbestand (docs/saga-aanbevolen-instellingen.json), docs/CONTROLELIJST.md.
Niet getest: echte schermen en tv's (marge, spiegelen), spraak (browser blokkeert dit vaak zonder aanraking), scherm aan houden op een echt scherm, meldingen in de rustige uren op je telefoon.

## Proxmox: één opdracht om de bestaande machine bij te werken
`tools/proxmox-update.sh`: zoekt de Saga-machine, haalt de nieuwste schijf (ISO), zet hem in het dvd-station, voegt een lege gegevensschijf van 4 GB toe als de machine geen schijf heeft, en start opnieuw. Getest met nagebootste Proxmox-opdrachten (zonder en met schijf, zonder toetsenbord, onbekende machine, te kleine download); NIET op een echte Proxmox-server.

## 3.5.0-beta.10 — accounts met pincode, cookie, Energie in 24 uur, reserve
- **Account maken**: altijd een knop op het deurscherm en de bezoekerspagina (aan/uit bij Bezoekers). Alleen een naam (en e-mail) is nodig: de server bedenkt een willekeurige pincode van 4, 6 of 8 cijfers (standaard 6) en toont die. Het cijferblok staat er altijd, ook als er nog niemand is. Jij krijgt bij elk nieuw account een melding met de naam (ntfy en mail, behalve in rustige uren). De pincode staat nergens in meldingen of het logboek.
- **Cookie** `saga_v`: alleen op telefoons (niet op het deurscherm), willekeurig nummer, een jaar, HttpOnly. Een telefoon die eerder een pincode gebruikte of een account maakte wordt de volgende keer met naam gegroet. In de statistiek: terugkerende telefoons. Uitgelegd in PRIVACY.md.
- **Energie**: tijden kiezen met uur- en minutenlijsten (24 uur), zodat AM/PM-velden in Safari niet meer lukraak leeg blijven. De server begrijpt ook 7:05, 07.05 en 07:05:00.
- **Reserve**: een uurlijkse reservekopie (alleen als er iets veranderd is, bewaard per dag, 7 dagen) naast de nachtelijke back-ups. Knoppen houden hun nummer bij opslaan vanuit de apps.
- Niet getest: cookies via https op een echte telefoon, de melding van een nieuw account op je telefoon, 4 en 8 cijfers op het deurscherm zelf.

## 3.5.0-beta.12 — zie docs/PLAN-beta12.md
Gemak, functies en schermen in het paneel, het deurscherm en de apps (iPhone/iPad/Mac, Windows/Linux, desktop-app). Niet getest: Engels op een echt scherm (alleen de zichtbaarste teksten zijn vertaald), de pagina's in de apps op een echt apparaat, de Windows/Linux-app (alleen door de bouw op GitHub).

## 3.5.0-beta.16 — kant-en-klare knoppen
Instellingen → Kant-en-klare knoppen: 21 knoppen (pakketje, ik heb een afspraak, ik kom later terug, hulp, spoed, storing, laptop, wachtwoord, printer, wifi-hulp, handtekening, lenen, terugbrengen, kwijt/gevonden, waar moet ik zijn, vergadering, gast aanmelden, annuleren, tip of klacht, openingstijden, terugbellen) die je los aan en uit zet; Nederlands en Engels; ze verschijnen op het deurscherm en de bezoekerspagina, in rijen van 3 of 4. Bij veel knoppen: rijen in plaats van één lange rij. Ook in "Alle instellingen" en de apps (veld quickButtons).

## 3.5.0-beta.18
- **Paneel in categorieën:** elke lange pagina (Status, Instellingen, Ontwerp, Beheer, Beveiliging, Systeem en Alle instellingen) toont één soort dingen tegelijk, met bovenaan "Wat wil je doen?" en knoppen (bij Instellingen: Dag, Bezoekers, Scherm, Meldingen, Computer en desktop). "Alles" laat alles op één pagina zien; zoeken zoekt altijd overal.
- **Annuleren met een nummer:** elke vraag, afspraak en terugbelverzoek krijgt een nummer van zes cijfers (op het scherm, in de bevestigingsmail en bij het verzoek in het paneel). Met de knop "Annuleren" tik je het nummer in, je ziet wat het is, en je annuleert (een reden mag, hoeft niet). De afspraak komt weer vrij en jij krijgt een melding. Een afgehandelde vraag kan niet meer geannuleerd worden, een afspraak wel. Aan/uit bij Bezoekers. De knop "Afspraak annuleren" bij de kant-en-klare knoppen is hiermee vervangen.
- **Thema's:** Donker, Licht, Middernacht, Bos, Grafiet, Papier en Lucht; plus "Vak om de status": vanzelf, geen, gekleurd, zacht, rand of donker (dus ook een licht thema met een donker vak, of een donker thema met een gekleurd vak).
