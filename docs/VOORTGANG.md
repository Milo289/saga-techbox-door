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
