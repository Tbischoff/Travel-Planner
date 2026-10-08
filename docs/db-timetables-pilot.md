# DB Timetables Pilot – v2.4.0

Status: **Testfunktion, nicht in der Tagesplanung eingebunden**.

## Deployment
1. In Supabase → Edge Functions → Deploy a new function → via Editor/CLI: `db-timetables` mit dem Inhalt von `supabase/functions/db-timetables/index.ts` bereitstellen.
2. JWT-Prüfung **aktiviert lassen**. Die Funktion benötigt `DB_CLIENT_ID` und `DB_API_KEY` als Supabase Secrets.
3. In Supabase → Edge Functions → `db-timetables` → Test: Methode POST, JSON-Body:
   `{"action":"station","pattern":"Frankfurt(Main)Hbf"}`
4. Die erhaltene EVA-Nummer für einen Testabruf verwenden (Beispiel Frankfurt Hbf: 8000105). Datum/Uhrzeit sind **deutsche Ortszeit** und explizit anzugeben:
   `{"action":"board","eva":"8000105","date":"261008","hour":"14"}`
5. Die Antwort enthält die geplanten und geänderten Ankunfts- und Abfahrtszeiten und Gleise, sofern die DB diese liefert. Kein automatischer Google-Abgleich und keine UI-Integration.

## Sicherheit und Grenzen
- API-Zugangsdaten werden ausschließlich serverseitig aus Secrets gelesen.
- Nur POST, keine Rückgabe von Zugangsdaten oder DB-Rohantworten.
- JWT-Gateway-Schutz muss beim Deployment aktiviert bleiben. Weitere Benutzer-/Reiseberechtigungsprüfung vor Produktivfreigabe erforderlich.
- Das DB-Free-Kontingent ist begrenzt. Die Board-Aktion verbraucht **zwei** DB-API-Aufrufe (Plan + Änderungen).
- Bei fehlenden Feldern oder Abweichungen keine Echtzeitdaten erfinden.
- XML-Parser-Abhängigkeit: `npm:fast-xml-parser@4.5.3`.
- Noch nicht gegen einen echten DB-API-Key ausgeführt.

## Erweiterte Felder
- `arrivals` und `departures` werden separat zurückgegeben; bei Zwischenhalten kann derselbe Zug in beiden Listen erscheinen.
- `delayMinutes` wird aus Soll- und Änderungszeit berechnet; `null` bedeutet keine Änderungszeit gemeldet, nicht zwingend pünktlich.
- `effectivePlatform` und `platformChanged` zeigen gemeldete Gleiswechsel.
- `cancelled` ist bei DB-Status `c` gesetzt. Status kann auch nur Ankunft oder Abfahrt betreffen; beide Einzelwerte prüfen.
- `line` ist die DB-interne Zugnummer und darf nicht ohne Abgleich als öffentliche S-/U-Bahn-Linie angezeigt werden.
- Änderungen an GitHub-Dateien deployen sich nicht automatisch zu Supabase Edge Functions: nach PR-Merge erneut bereitstellen und testen.
