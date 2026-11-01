// Cloudflare Pages Function: restrict Wikimedia proxy to the API calls used by the crest lookup.
const HOSTS = new Set(["www.wikidata.org", "commons.wikimedia.org"]);
const ACTIONS = new Set(["wbsearchentities", "wbgetentities", "query"]);
const ALLOWED = new Set(["action", "prop", "search", "language", "uselang", "type", "limit", "ids", "props", "titles", "iiprop", "iiurlwidth"]);
export async function onRequestGet({ request }) {
  const input = new URL(request.url);
  const host = input.searchParams.get("host");
  const action = input.searchParams.get("action");
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!HOSTS.has(host) || !ACTIONS.has(action)) {
    return new Response(JSON.stringify({ error: "Unzulässiger Wikimedia-Host oder API-Aktion" }), { status: 400, headers });
  }
  const params = new URLSearchParams({ format: "json", action });
  for (const [key, value] of input.searchParams) {
    if (ALLOWED.has(key) && key !== "action") params.set(key, value);
  }
  const endpoint = "https://" + host + "/w/api.php?" + params.toString();
  try {
    const upstream = await fetch(endpoint, { headers: { "Accept": "application/json", "User-Agent": "TravelPlanner/2.6.3 (https://trip-planner-smart.pages.dev; Wikimedia coat-of-arms lookup)" }, redirect: "follow" });
    const body = await upstream.text();
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "Wikimedia HTTP " + upstream.status, detail: body.slice(0, 300) }), { status: 502, headers });
    }
    try { JSON.parse(body); }
    catch { return new Response(JSON.stringify({ error: "Wikimedia lieferte kein JSON" }), { status: 502, headers }); }
    return new Response(body, { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Wikimedia nicht erreichbar: " + String(error?.message || error) }), { status: 502, headers });
  }
}
