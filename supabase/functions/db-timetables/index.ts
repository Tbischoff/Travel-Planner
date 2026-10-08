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
type Xml = Record<string, unknown>;
const record = (value: unknown): Xml => (value && typeof value === "object" && !Array.isArray(value)) ? value as Xml : {};
function eventInfo(plannedValue: unknown, changedValue: unknown) {
  const p = record(plannedValue), c = record(changedValue);
  if (!p.pt) return null;
  const plannedTime = attr(p, "pt"), changedTime = attr(c, "ct") || attr(p, "ct");
  const plannedPlatform = attr(p, "pp"), changedPlatform = attr(c, "cp") || attr(p, "cp");
  const plannedStatus = attr(p, "ps"), changedStatus = attr(c, "cs") || attr(p, "cs");
  const effectiveStatus = changedStatus || plannedStatus;
  const parseDbTime = (t: string): number | null => {
    if (!/^\d{10}$/.test(t)) return null;
    const year = 2000 + Number(t.slice(0, 2));
    const month = Number(t.slice(2, 4)), day = Number(t.slice(4, 6));
    const hour = Number(t.slice(6, 8)), minute = Number(t.slice(8, 10));
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    return Date.UTC(year, month - 1, day, hour, minute);
  };
  const start = parseDbTime(plannedTime), end = parseDbTime(changedTime);
  return {
    plannedTime, changedTime, effectiveTime: changedTime || plannedTime,
    delayMinutes: start !== null && end !== null ? Math.round((end - start) / 60000) : null,
    plannedPlatform, changedPlatform, effectivePlatform: changedPlatform || plannedPlatform,
    platformChanged: Boolean(changedPlatform && plannedPlatform && changedPlatform !== plannedPlatform),
    plannedStatus, changedStatus, cancelled: effectiveStatus === "c",
    plannedPath: attr(p, "ppth"), changedPath: attr(c, "cpth") || attr(p, "cpth")
  };
}
function timetableEntry(s: Xml, update: Xml | undefined) {
  const line = record(s.tl ?? update?.tl);
  const arrival = eventInfo(s.ar, update?.ar);
  const departure = eventInfo(s.dp, update?.dp);
  return {
    id: attr(s, "id"), line: attr(line, "n"), category: attr(line, "c"),
    operator: attr(line, "o"), tripLabel: attr(s, "l") || attr(update ?? {}, "l"),
    arrival, departure,
    cancelled: Boolean(arrival?.cancelled || departure?.cancelled)
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
      const entries = stops(plan).map(s => timetableEntry(s, byId.get(attr(s, "id"))));
      const departures = entries.filter(s => s.departure !== null);
      const arrivals = entries.filter(s => s.arrival !== null);
      return json({ eva, date, hour, departures, arrivals, retrievedAt: new Date().toISOString(),
        note: "DB-Daten; keine automatische Zuordnung zu Google-Verbindungen." });
    }
    return json({ error: "Unbekannte Aktion." }, 400);
  } catch (e) {
    console.error("DB Timetables pilot:", e instanceof Error ? e.message : "Fehler");
    return json({ error: "DB-Abfrage fehlgeschlagen. Funktionslogs prüfen." }, 502);
  }
});
