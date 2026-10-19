# Controlelijst: werkt alles?

Doe dit na het installeren van een nieuwe versie. Alles wat je aanvinkt, weet je zeker. Wat niet lukt, noteer je en geef je aan Claude.

## 0. In één keer testen
1. Open `http://<je server>:8080/check` (of `https://saga-deur.local:8443/check`).
2. Druk op **Alles testen**. Dit probeert bijna alles zelf, ook het opslaan met de echte knoppen.
3. Kopieer het resultaat bij **Prompt voor Claude** en plak het in het gesprek.

## 1. Eenmalig instellen (de lijst "Eerste keer instellen" op de pagina Status doet dit voor je)
- [ ] **Tweede schijf** aan de virtuele machine (Proxmox → VM → Hardware → Add → Hard Disk, minstens 4 GB, leeg). Zonder die schijf verdwijnen je gegevens bij een herstart.
- [ ] VM start mee met Proxmox (Options → Start at boot).
- [ ] **Instellingen → Alle instellingen → Instellingen uit een bestand toepassen**: kies `saga-aanbevolen-instellingen.json` (staat bij de uitgave en in `docs/`).
- [ ] **Beveiliging → https aan**, daarna het certificaat installeren op je Mac, iPhone en iPad.
- [ ] **Tweestapsverificatie** aan voor `milo`, en een **passkey** toevoegen.
- [ ] **Beveiliging → Back-ups, aanvalsbeveiliging en herstart → Wachtwoord voor back-ups** kiezen. Daarna **Nu een back-up maken** en **Test back-up**.
- [ ] **E-mail of ntfy** instellen en op **Test versturen** drukken.
- [ ] **Openingstijden** invullen, en je **schoolnaam**.
- [ ] Privacyverklaring: vul onderaan `PRIVACY.md` je organisatie en contactpersoon in.

## 2. Het deurscherm
- [ ] Open het deurscherm op de echte monitor. Kies bij **Instellingen → Weergave** een modus (horizontaal/verticaal, grote klok, smalle balk …) en kijk of alles past.
- [ ] Klopt de **marge**? Zie je de randen op de tv? Zet dan Marge rond het beeld op 3 tot 5.
- [ ] Druk op **Aanbellen** op het deurscherm: hoor je de bel, zie je de melding in het paneel en op je telefoon?
- [ ] Zet bij **Eigen knoppen** een wifi-knop aan. Scan de QR-code met je telefoon: maakt hij verbinding?
- [ ] Zet de **Schermbeveiliging** aan en wacht: dimt het scherm en komt het terug bij een aanraking?
- [ ] Kies **Plaats van de eigen knoppen** (onder, boven, zijkant, zwevend) en kijk of ze niets bedekken.

## 3. Het paneel
- [ ] Druk **O**, **G** en **B**: verandert de status? Druk **?** voor de sneltoetsen.
- [ ] Wijzig "Computer uit" bij Energie en sla op met de **grote knop**. Ververs de pagina: staat de tijd er nog?
- [ ] **Drukte** (op Status) en **Privacy** (onder Beheer): zoek een testnaam en wis hem.
- [ ] **Bericht op de deur per datum**: zet er één voor vandaag en kijk op het deurscherm.
- [ ] **Rustige uren**: zet ze aan en bel aan in die uren: komt er géén melding op je telefoon, wel in het paneel?
- [ ] **Systeem → Server bijwerken → Zoek naar updates**, en bij een nieuwere versie **Bijwerken**. Daarna eventueel **Terug naar de vorige versie**.

## 4. Apps
- [ ] **iPhone/iPad/Mac:** inloggen met 2FA, de server in de lijst, de beveiligingspagina met "Server bijwerken".
- [ ] **Windows/Linux:** inloggen, de app onthoudt zijn venster, de melding bij een bezoeker.
- [ ] **Desktop-app:** eerste start vraagt om akkoord met de voorwaarden. Opstarten bij inloggen.

## 5. Back-up en herstel
- [ ] Zet je **oude gegevens** terug (Instellingen → Meer → Back-up terugzetten, of Systeem → Gegevens overzetten).
- [ ] Start de VM opnieuw op: zijn je gegevens er nog? (Dat bewijst dat de gegevensschijf werkt.)

## 6. Wat Claude niet zelf kan testen
Je netwerk en Proxmox, passkeys op echte apparaten, het uiterlijk op een echte iPhone/iPad, VoiceOver, meldingen op Windows/Linux, een echte uitschakeling van een computer, een echte stroomuitval, het versturen van echte mail, en een echte update van de ene naar de andere beta.
