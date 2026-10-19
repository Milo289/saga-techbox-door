# Privacyverklaring Saga Techbox Deur

*Versie 1 – oktober 2026. Dit is een voorlopige tekst voor een beta. Laat hem controleren door je school (privacyfunctionaris) en vul de gegevens van je eigen organisatie in bij punt 8.*

## 1. Kort samengevat
* De software draait op **jouw eigen server**. De ontwikkelaar ontvangt **geen** gegevens: geen meetgegevens, geen gebruiksstatistieken, geen bezoekersgegevens.
* Jouw school of organisatie is de **verwerkingsverantwoordelijke**. Zij bepaalt welke gegevens worden verzameld en hoe lang ze worden bewaard.
* Gegevens blijven op de server, tenzij je zelf iets koppelt (zie punt 5).

## 2. Welke gegevens worden verwerkt
| Wie | Gegevens | Waarvoor |
|---|---|---|
| Bezoekers | naam, reden van het bezoek, eventueel een bericht, tijdstip, de keuze om toestemming te geven | de gebruiker van de deur laten weten wie er is en kunnen antwoorden |
| Personen in de lijst | naam en wat je zelf invult (bijvoorbeeld een nummer of een label) | herkennen of aankondigen van bekende bezoekers |
| Beheerders | gebruikersnaam, naam, wachtwoord (alleen als onomkeerbare code), tweestapscode en passkeys (versleuteld) | inloggen |
| Alle gebruikers van het paneel | IP-adres, tijdstip en soort apparaat in het logboek en in de lijst met sessies | beveiliging, het opsporen van misbruik |
| Afspraken en roosters | wat je zelf invult | het deurbord laten kloppen |
| Apparaten en camera's (alleen als jij ze koppelt) | gebeurtenissen die zij melden | automatisering, bijvoorbeeld een slot |

## 3. Grondslag
Voor beheerders en beveiliging: gerechtvaardigd belang (een veilig systeem). Voor bezoekers: toestemming of gerechtvaardigd belang van de organisatie. Welke grondslag geldt, bepaalt de organisatie die de software gebruikt.

## 4. Bewaartermijnen
De instelling **Bezoekersverzoeken bewaren (dagen)** onder Systeem bepaalt hoelang verzoeken blijven staan. Bij een nieuwe installatie staat dit op **90 dagen**. **0 betekent dat ze blijven staan tot iemand ze verwijdert**, en een server die uit een oude back-up is teruggezet houdt zijn eigen instelling. Kies bewust een termijn. Back-ups bevatten dezelfde gegevens en worden zoveel dagen bewaard als je bij Aantal back-ups bewaren instelt. Het logboek is bedoeld om aantoonbaar te zijn en wordt niet automatisch gewist. De server schrijft verder een klein bestand met het laatste tijdstip waarop hij draaide, om te kunnen melden dat hij onverwacht is uitgevallen.

## 5. Delen met anderen
Standaard deelt de software niets. Dit gebeurt alleen als de beheerder het aanzet:
* **E-mail** via de mailserver die de beheerder invult (bijvoorbeeld Gmail). Berichten gaan dan via die dienst.
* **Meldingen** via ntfy of een webhook-adres dat de beheerder invult.
* **Updates:** de software vraagt GitHub of er een nieuwere versie is. GitHub ziet dan het IP-adres van de server, zoals bij elk bezoek aan een website.
* **Apple, Google en Microsoft** zijn alleen betrokken bij het installeren van apps, niet bij de gegevens op de server.

## 6. Beveiliging
Wachtwoorden worden alleen als onomkeerbare code bewaard. Geheimen (mailwachtwoord, tokens, tweestapsleutels) worden versleuteld opgeslagen. Het logboek heeft een ketting, zodat aanpassingen opvallen. Er is tweestapsverificatie en inloggen met een passkey, en een aanvalsbeveiliging. Op een lokaal netwerk kun je https aanzetten met een eigen certificaat. Alle maatregelen helpen, maar geen enkel systeem is helemaal veilig: houd de software bijgewerkt en maak back-ups.

## 7. Jouw rechten
Mensen van wie gegevens zijn opgeslagen mogen vragen om **inzage**, **correctie**, **verwijdering** en **beperking**, en mogen bezwaar maken. Vraag het aan de organisatie die de server beheert (zie punt 8). Een beheerder kan een bericht verwijderen in het paneel (Bezoekers), de bewaartermijn instellen en alle gegevens exporteren (Systeem → Gegevens overzetten). Klachten kun je indienen bij de Autoriteit Persoonsgegevens.

## 8. Wie is verantwoordelijk
Vul hier in voor je eigen server: naam van de organisatie, adres, en een contactpersoon of functionaris voor gegevensbescherming.

> Organisatie: …  
> Contact: …

## 9. Wijzigingen
Deze verklaring kan veranderen. De versie staat bovenaan.
