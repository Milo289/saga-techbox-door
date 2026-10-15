# Apparaten, slot, NFC en camera’s koppelen

Alles hier staat standaard **uit**. Je regelt het in Beheer → Instellingen → **Koppelingen**.

## 1. Een API-sleutel maken
Beheer → Instellingen → API-sleutels → nieuwe sleutel. Geef hem alleen de rechten die het apparaat nodig heeft:

| Recht | Waarvoor |
|---|---|
| `devices` (Microcontrollers) | Een ESP32/Pico meldt knoppen en sensoren en leest de status |
| `unlock` (Het slot) | Een RFID-lezer meldt een tag; het paneel mag het slot beheren |
| `cameras` | Een camera-AI meldt wie er voor de deur staat |

Alleen de hoofdaccount heeft deze rechten standaard. Geef ze nooit meer dan nodig.

## 2. ESP32, Raspberry Pi Pico W en andere microcontrollers
Elk apparaat dat HTTP kan spreken werkt. Twee aanroepen, beide met `Authorization: Bearer door_…`:

* `POST /api/device/report` met `{"device":"deurknop","event":"press"}` — meldt iets (en maakt het apparaat vanzelf aan in de lijst). Het antwoord bevat meteen de status: `mode` (`open`/`closed`/`busy`), `label`, `message`, `color` (bijv. `#30d158`, handig voor een ledje), `until`.
* `GET /api/device/poll?device=deurknop` — alleen de status ophalen, bijv. elke 10 seconden om een led of schermpje bij te werken.

Voorbeelden: [docs/firmware/esp32.ino](firmware/esp32.ino) (Arduino) en [docs/firmware/pico_w.py](firmware/pico_w.py) (MicroPython). Met **Regels** in het paneel koppel je een gebeurtenis aan een actie, bijvoorbeeld “als `deurknop` `press` meldt: status Bezet voor 10 minuten”.

## 3. Het slot en RFID (of NFC)
RFID-kaartjes en sleutelhangers (125 kHz of 13,56 MHz) en NFC-pasjes werken allemaal: de lezer leest een nummer en meldt het. Je lezer (bijv. een ESP32 met een RC522 of PN532, of een losse Wiegand-lezer via een microcontroller) stuurt bij elk kaartje `POST /api/door/rfid` met `{"uid":"04:A2:3B:9C"}` (`/api/door/tag` werkt ook). Vul het nummer in het paneel precies zo in als je lezer het meldt. Het antwoord zegt `allowed: true/false`, dus de lezer kan piepen of knipperen. In het paneel zet je de kaartjes neer met naam, dagen en tijden. Het slot zelf gaat open doordat de server **het webadres van het slot** aanroept dat je bij “Slot” invult. Heb je de API van het slot nog niet: laat het leeg, dan gebeurt er niets. Mislukte of geweigerde pogingen staan in het activiteitenlog.

## 4. Camera’s en herkennen wie er is (AI)
De server doet zelf **geen** gezichtsherkenning (dat vraagt zware AI-software). Er is een splitsing:

1. Een kleine AI draait naast je camera (op een Raspberry Pi 5, mini-pc of de server zelf) en herkent mensen. Een voorbeeld staat in [tools/camera-ai](../tools/camera-ai/README.md); bestaande programma’s zoals Frigate of Double Take kunnen ook, via een webhook.
2. De AI meldt `POST /api/camera/event` met `{"camera":"voordeur","kind":"face","name":"Milo","confidence":0.93}`.
3. De server doet alleen iets bij **personen die toestemming hebben gegeven** en alleen boven de ingestelde zekerheid. Daarna: status, bericht, melding. Er worden **nooit beelden** bewaard, alleen naam, camera en tijd, en die worden na de ingestelde dagen gewist.

**Een gezicht opent de deur nooit**, ook niet als je een regel aanvinkt: een foto kan een camera misleiden. Voor binnenkomen gebruik je een RFID-kaartje.

**Privacy:** gezichten zijn persoonsgegevens (AVG). Vraag toestemming (bij leerlingen onder de 16 van de ouders), vertel dat de camera er is en laat mensen zich kunnen uitschrijven (haal ze uit de lijst “Personen”).
