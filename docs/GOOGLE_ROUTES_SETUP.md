# Google Routes API – Setup

Der Travel Planner verwendet die Google Routes API für die Routenberechnung.

## Google Cloud

1. Im verwendeten Google-Cloud-Projekt **APIs & Dienste → Bibliothek** öffnen.
2. **Routes API** suchen und aktivieren.
3. Unter **APIs & Dienste → Anmeldedaten** den verwendeten API-Key öffnen.
4. Bei den API-Einschränkungen die **Routes API** freigeben.
5. Die HTTP-Referrer auf die produktive Travel-Planner-Domain beschränken:
   - `https://trip-planner-smart.pages.dev/*`
6. Nach Änderungen den Travel Planner neu laden und eine Route mit mindestens zwei Stopps testen.

Der API-Key ist im Browser technisch sichtbar und muss deshalb über HTTP-Referrer und die benötigten APIs eingeschränkt bleiben.
