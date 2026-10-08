# DB Timetables Pilot – v2.4.0

Status: **Testfunktion, nicht in der Tagesplanung eingebunden**.

## Deployment
1. In Supabase → Edge Functions → Deploy a new function → via Editor/CLI: `db-timetables` mit dem Inhalt von `supabase/functions/db-timetables/index.ts` bereitstellen.
2. JWT-Prüfung **aktiviert lassen**. Die Funktion benötigt `DB_CLIENT_ID` und `DB_API_KEY` als Supabase Secrets.
3. In Supabase → Edge Functions → `db-timetables` → Test: Methode POST, JSON-Body:
   `{"action":"station","pattern":"Frankfurt(Main)Hbf"}`
4. Die erhaltene EVA-Nummer für einen Testabruf verwenden (Beispiel Frankfurt Hbf: 8000105). Datum/Uhrzeit sind **deutsche Ortszeit** und explizit anzugeben:
   `{"action":"board","eva":"8000105","date":"261008","hour":"14"}`
5. Die Antwort enthält die geplanten und geänderten Abfahrtszeiten und Gleise, sofern die DB diese liefert. Kein automatischer Google-Abgleich und keine UI-Integration.

## Sicherheit und Grenzen
- API-Zugangsdaten werden ausschließlich serverseitig aus Secrets gelesen.
- Nur POST, keine Rückgabe von Zugangsdaten oder DB-Rohantworten.
- JWT-Gateway-Schutz muss beim Deployment aktiviert bleiben. Weitere Benutzer-/Reiseberechtigungsprüfung vor Produktivfreigabe erforderlich.
- Das DB-Free-Kontingent ist begrenzt. Die Board-Aktion verbraucht **zwei** DB-API-Aufrufe (Plan + Änderungen).
- Bei fehlenden Feldern oder Abweichungen keine Echtzeitdaten erfinden.
- XML-Parser-Abhängigkeit: `npm:fast-xml-parser@4.5.3`.
- Noch nicht gegen einen echten DB-API-Key ausgeführt.
