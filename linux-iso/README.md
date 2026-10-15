# Saga Techbox Deur OS (eigen Linux)

Een Linux-schijf (ISO) die zonder iets te installeren opstart, de deurserver start en het deurscherm in beeld zet. Handig voor een oude pc of een mini-pc die alleen een deurscherm is.

**Gebruiken:** download `Saga-Techbox-Deur-OS-<type>.iso` bij de release, zet hem met Balena Etcher of Rufus op een usb-stick, start de pc daarvan op. Binnen een minuut staat het deurscherm er. Het bedieningspaneel staat op `http://saga-deur.local:8080/admin` (of het IP-adres van de pc).

**Gegevens bewaren:** een live-schijf vergeet alles bij een herstart. Maak daarom op dezelfde stick een tweede partitie met de naam `persistence` met daarin een bestand `persistence.conf` met de regel `/var/lib/saga-door union`, en start met “Live system (persistence)”. Of zet de gegevens in de server via Beheer → Back-up.

**Zelf bouwen:** `sudo apt-get install live-build && sudo ./linux-iso/build.sh` (Debian of Ubuntu). GitHub bouwt hem ook zelf bij elke release (workflow “Eigen Linux”).

**Let op:** alleen Ethernet is ingebouwd; wifi-kaarten die extra firmware nodig hebben werken (nog) niet. Deze schijf is gemaakt zonder hem op echte hardware te kunnen proberen: probeer hem eerst in een virtuele machine.

**Welk bestand?** `…-amd64.iso` voor bijna elke pc en laptop (Intel/AMD), `…-i386.iso` voor heel oude 32-bits pc’s, `…-arm64.iso` voor ARM-computers (bijv. mini-pc’s met ARM-chip, en een Mac met Apple-chip in een virtuele machine). Een Raspberry Pi start niet van een ISO: gebruik daar Raspberry Pi OS met het `…-linux-arm64.deb`-bestand.

## Uitproberen zonder tweede computer
Je kunt de schijf op je eigen computer proberen in een virtuele computer; je hoeft niets te installeren op de stick of een andere pc.

* **Mac of Linux:** installeer QEMU (`brew install qemu`) en start `./linux-iso/test-vm.sh Saga-Techbox-Deur-OS-amd64.iso`. Er opent een venster waarin de pc opstart en het deurscherm verschijnt (op een Mac met Apple-chip is het `…-arm64.iso` veel sneller). Het bedieningspaneel staat dan op http://localhost:8080/admin in je eigen browser.
* **Windows (of liever met knoppen):** installeer VirtualBox (gratis). Nieuwe machine → Linux/Debian 64-bit, 2 GB geheugen, geen harde schijf nodig → Instellingen → Opslag → kies het ISO-bestand → Netwerk → Geavanceerd → Port forwarding: host 8080 → gast 8080. Start de machine.
* **Mac met knoppen:** UTM (gratis, utmapp.com): “Virtualize” voor de arm64-schijf of “Emulate” voor amd64.
* **Automatisch:** bij elke release start GitHub de amd64-schijf zelf in een virtuele computer en controleert of de server binnen een paar minuten antwoordt (workflow “Eigen Linux”, stap “Opstarttest”).
