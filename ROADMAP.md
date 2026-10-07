# Hoe de app wordt bijgewerkt

## De vier stappen
1. **Jij kiest** welke ideeën je wilt (de pagina met 50 ideeën; Ja / Misschien / Nee).
2. **Claude bouwt in rondes** van 5 tot 8 ideeën. Eerst de kleine, dan de grotere. Wat niet getest kan worden zonder jouw apparaat, staat erbij.
3. **Alles wordt getest** voordat het uitkomt: de automatische tests (`npm test`, nu 32) en een build voor Windows, macOS, Linux en iPhone/iPad.
4. **Nieuwe versie op GitHub** (een tag `vX.Y.Z`). De computer-apps melden zelf "Update beschikbaar" (Instellingen → Updates). Voor de iPhone/iPad installeer je opnieuw (`ios/install.sh`, of AltStore ververst het zelf).

## Versienummers
- `X.Y.Z`: **Z** = kleine reparatie, **Y** = nieuwe functies, **X** = grote vernieuwing (zoals de echte iPhone-app in 2.0).
- Voor elke versie is er een bewaarpunt (`works-vNN`). Terugzetten: `./restore.sh works-vNN`.

## Voorstel voor de rondes (na jouw keuzes)
| Ronde | Inhoud | Doel |
|---|---|---|
| 1 | Alle "Ja"-ideeën met inspanning **klein** | Snel zichtbaar resultaat |
| 2 | Alle "Ja"-ideeën met inspanning **middel** | De meest gebruikte uitbreidingen |
| 3 | Alle "Ja"-ideeën met inspanning **groot** | De grote stappen, één voor één |
| 4 | "Misschien"-ideeën die je na ronde 1–3 nog wilt | Bijsturen |

## Wat een idee kan kosten
- **gratis**: alleen werk, geen extra dienst.
- **extra dienst**: een koppeling met een andere dienst (agenda, Slack, een belprovider). Soms met een eigen account of kosten daar.
- **betaald account**: alleen met het Apple Developer Program (99 dollar per jaar), bijvoorbeeld echte Apple-pushmeldingen of een app die een jaar blijft werken.
