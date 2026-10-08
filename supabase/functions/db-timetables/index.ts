// Supabase Edge Function: DB Timetables pilot (read-only).
// Deploy with JWT verification enabled. Secrets: DB_CLIENT_ID, DB_API_KEY.
// POST {"action":"station","pattern":"Frankfurt(Main)Hbf"}
// POST {"action":"board","eva":"8000105","date":"261008","hour":"14"}
import { XMLParser } from "npm:fast-xml-parser@4.5.3";

const API = "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const array = (v: unknown): Record<string, unknown>[] =>
  v == null ? [] : (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
const attr = (v: Record<string, unknown>, k: string) => String(v?.[k] ?? "");
const stationEntries = (parsed: Record<string, unknown>) => {
  const root = parsed.stations as Record<string, unknown> | undefined;
  return array(root?.station).map(s => ({ eva: attr(s, "eva"), name: attr(s, "name"), ds100: attr(s, "ds100") }));
};
const stops = (parsed: Record<string, unknown>) => {
  const root = parsed.timetable as Record<string, unknown> | undefined;
  return array(root?.s);
};
function eventInfo(value: unknown) {
  const e = value as Record<string, unknown> | undefined;
  if (!e) return null;
  return {
    plannedTime: attr(e, "pt"), changedTime: attr(e, "ct"),
    plannedPlatform: attr(e, "pp"), changedPlatform: attr(e, "cp"),
    plannedStatus: attr(e, "ps"), changedStatus: attr(e, "cs"),
    plannedPath: attr(e, "ppth"), changedPath: attr(e, "cpth")
  };
}
async function dbGet(path: string) {
  const id = Deno.env.get("DB_CLIENT_ID"), key = Deno.env.get("DB_API_KEY");
  if (!id || !key) throw new Error("DB-Secrets fehlen.");
  const response = await fetch(API + path, {
    headers: { "DB-Client-Id": id, "DB-Api-Key": key, "Accept": "application/xml" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`DB API HTTP ${response.status}`);
  return parser.parse(await response.text()) as Record<string, unknown>;
}
Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);
  try {
    const body = await request.json();
    if (body.action === "station") {
      const pattern = String(body.pattern ?? "").trim();
      if (pattern.length < 2 || pattern.length > 80) return json({ error: "Ungültiger Stationsname." }, 400);
      return json({ stations: stationEntries(await dbGet("/station/" + encodeURIComponent(pattern))) });
    }
    if (body.action === "board") {
      const eva = String(body.eva ?? "");
      const date = String(body.date ?? "");
      const hour = String(body.hour ?? "");
      if (!/^\d{7}$/.test(eva) || !/^\d{6}$/.test(date) || !/^(0\d|1\d|2[0-3])$/.test(hour))
        return json({ error: "eva (7 Ziffern), date (YYMMDD), hour (HH) erforderlich." }, 400);
      const [plan, changes] = await Promise.all([
        dbGet(`/plan/${eva}/${date}/${hour}`), dbGet(`/fchg/${eva}`)
      ]);
      const byId = new Map(stops(changes).map(s => [attr(s, "id"), s]));
      const departures = stops(plan).map(s => {
        const update = byId.get(attr(s, "id"));
        const planned = s.dp as Record<string, unknown> | undefined;
        const changed = update?.dp as Record<string, unknown> | undefined;
        const line = (s.tl ?? update?.tl ?? {}) as Record<string, unknown>;
        return {
          id: attr(s, "id"), line: attr(line, "n"), category: attr(line, "c"),
          operator: attr(line, "o"), departure: {
            ...eventInfo(planned),
            changedTime: attr(changed ?? {}, "ct"),
            changedPlatform: attr(changed ?? {}, "cp"),
            changedStatus: attr(changed ?? {}, "cs")
          }
        };
      }).filter(s => s.departure?.plannedTime);
      return json({ eva, date, hour, departures, retrievedAt: new Date().toISOString(),
        note: "Nur Pilotdaten; noch kein Abgleich mit Google-Verbindungen." });
    }
    return json({ error: "Unbekannte Aktion." }, 400);
  } catch (e) {
    console.error("DB Timetables pilot:", e instanceof Error ? e.message : "Fehler");
    return json({ error: "DB-Abfrage fehlgeschlagen. Funktionslogs prüfen." }, 502);
  }
});
