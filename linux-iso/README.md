# Saga Techbox Deur OS (eigen Linux)

Een Linux-schijf (ISO) die zonder iets te installeren opstart, de deurserver start en het deurscherm in beeld zet. Handig voor een oude pc of een mini-pc die alleen een deurscherm is.

**Gebruiken:** download `Saga-Techbox-Deur-OS-amd64.iso` bij de release, zet hem met Balena Etcher of Rufus op een usb-stick, start de pc daarvan op. Binnen een minuut staat het deurscherm er. Het bedieningspaneel staat op `http://saga-deur.local:8080/admin` (of het IP-adres van de pc).

**Gegevens bewaren:** een live-schijf vergeet alles bij een herstart. Maak daarom op dezelfde stick een tweede partitie met de naam `persistence` met daarin een bestand `persistence.conf` met de regel `/var/lib/saga-door union`, en start met “Live system (persistence)”. Of zet de gegevens in de server via Beheer → Back-up.

**Zelf bouwen:** `sudo apt-get install live-build && sudo ./linux-iso/build.sh` (Debian of Ubuntu). GitHub bouwt hem ook zelf bij elke release (workflow “Eigen Linux”).

**Let op:** alleen Ethernet is ingebouwd; wifi-kaarten die extra firmware nodig hebben werken (nog) niet. Deze schijf is gemaakt zonder hem op echte hardware te kunnen proberen: probeer hem eerst in een virtuele machine.
