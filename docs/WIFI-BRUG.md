# Wifi-brug: de netwerkpoort deelt de wifi

Een computer met wifi **en** een netwerkpoort (Ethernet) kan de wifi doorgeven aan andere computers die je in de netwerkpoort steekt, als een kleine router.

**Paneel:** Systeem → Netwerk → Wifi-brug (alleen het hoofdaccount).
1. *Netwerken zoeken* en een netwerk kiezen. Een wachtwoord typen en *Verbinden*.
2. Het vakje *Deel deze wifi-verbinding met de netwerkpoort* aanzetten.
3. Computers in de netwerkpoort krijgen vanzelf een adres (10.42.0.x) en internet via de wifi. De deur-computer zelf is dan alleen nog via wifi bereikbaar.

**Waar werkt het?**
* Op de Saga Linux-schijf (de server draait daar als beheerder): ja.
* Op Raspberry Pi OS (Bookworm of nieuwer, met NetworkManager): alleen als de deurserver als beheerder (root) draait, bijvoorbeeld als systeemdienst. De gewone desktop-app (`.deb`) draait als gewone gebruiker en mag het netwerk niet veranderen; het paneel zegt dat dan.
* Een Raspberry Pi start niet van de ISO; daar gebruik je Raspberry Pi OS.

**Beperkingen:** netwerken met bedrijfsbeveiliging (persoonlijke inlog, zoals eduroam) worden niet ondersteund. Sommige netwerken, zoals op scholen en bedrijven, verbieden eigen routers: overleg met de beheerder.

**Veiligheid:** het wifi-wachtwoord gaat rechtstreeks in het beschermde bestand van NetworkManager (alleen root kan het lezen) en wordt niet door de deurserver bewaard of gelogd. Alleen het hoofdaccount mag dit instellen.

**Niet getest op echte hardware:** de werking is getest met nagebootste `nmcli`- en `nft`-commando’s; probeer het eerst op een computer waar je niet van afhankelijk bent.
