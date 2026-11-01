const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "commons.wikimedia.org"]);
const HEADERS = { "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" };
export async function onRequestGet({ request }) {
  const requestUrl = new URL(request.url);
  const raw = requestUrl.searchParams.get("url");
  let target;
  try { target = new URL(raw); }
  catch { return new Response("Ungültige Bildadresse", { status: 400 }); }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname) ||
      (target.hostname === "upload.wikimedia.org" && !target.pathname.startsWith("/wikipedia/")) ||
      (target.hostname === "commons.wikimedia.org" && !target.pathname.startsWith("/wiki/Special:FilePath/"))) {
    return new Response("Bildquelle nicht erlaubt: " + target.hostname + target.pathname.slice(0, 180), { status: 400 });
  }
  try {
    const response = await fetch(target.toString(), {
      headers: { "Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8", "User-Agent": "TravelPlanner/2.6.8 (https://trip-planner-smart.pages.dev; Wikimedia crest images)" },
      redirect: "manual"
    });
    if (!response.ok) return new Response("Wappenbild HTTP " + response.status, { status: 502, headers: { "Cache-Control": "no-store" } });
    const type = response.headers.get("content-type") || "";
    if (!type.toLowerCase().startsWith("image/")) return new Response("Bildquelle lieferte kein Bild", { status: 502 });
    return new Response(response.body, { status: 200, headers: { ...HEADERS, "Content-Type": type } });
  } catch (error) {
    return new Response("Wappenbild nicht erreichbar: " + String(error?.message || error), { status: 502 });
  }
}
