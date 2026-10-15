# Camera-AI (voorbeeld)

`watch.py` herkent gezichten van een stilstaand camerabeeld en meldt “Milo is gezien” aan de deurserver (`POST /api/camera/event`). Zet foto’s van mensen die toestemming gaven in `gezichten/Naam.jpg` (één duidelijk gezicht per foto), en zet dezelfde naam in het paneel bij Koppelingen → Personen met “heeft toestemming gegeven”.

Dit is een startpunt dat ik niet met een echte camera kon proberen. Draait het niet lekker, dan kunnen programma’s zoals Frigate, Double Take of CompreFace hetzelfde melden via een webhook naar dezelfde aanroep. Lees `docs/APPARATEN.md` voor de privacyregels (AVG) en waarom een gezicht de deur nooit opent.
