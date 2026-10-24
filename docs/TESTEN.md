# Alles laten testen op je eigen computer

1. Zorg dat Node.js is geïnstalleerd (https://nodejs.org, de LTS-versie).
2. Download de nieuwste broncode van de release (de knop "Source code (zip)" op GitHub) en pak hem uit.
3. **Mac:** dubbelklik `Test-Alles.command`. **Windows:** dubbelklik `Test-Alles.bat`.
   (Mac: lukt dubbelklikken niet, klik met rechts en kies Open.)
4. Het script start een eigen, lege server op je computer (je echte gegevens blijven ongemoeid), controleert alles,
   maakt schermafbeeldingen van het deurscherm, de bezoekerspagina en elke pagina van het paneel
   (ook op telefoonbreedte) en zet alles in één map **Saga-testrapport-…** op je bureaublad, plus een zip-bestand.
5. Geef die map of dat zip-bestand aan Claude.

Voor de schermafbeeldingen is Chrome of Edge nodig. Edge zit al in Windows. Is er geen browser, dan vraagt het script of het
een testbrowser (Chrome for Testing, ongeveer 150 MB) van Google mag downloaden; dat blijft in `~/.saga-test-browser`.

Opties: `--volledig` voert daarna ook alle programmatests uit (duurt langer), `--ja` downloadt zonder te vragen,
`--geen-browser` maakt geen schermafbeeldingen.
