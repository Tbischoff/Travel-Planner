/**
 * Prepare the MapLibre glyph ranges used by the V2 Protomaps style.
 * This is a preparatory offline asset cache; a service worker and local glyph
 * URL are still required before offline text rendering can be enabled.
 */
const GLYPH_CACHE = 'travel-planner-map-glyphs-v1'
const FONT_STACK = 'Noto Sans Regular'
const RANGES = ['0-255', '256-511', '512-767', '768-1023']
const BASE = 'https://protomaps.github.io/basemaps-assets/fonts'

export async function cacheOfflineMapGlyphs(): Promise<{ stored: number; total: number }> {
  if (!('caches' in window)) return { stored: 0, total: RANGES.length }
  const cache = await caches.open(GLYPH_CACHE)
  let stored = 0
  for (const range of RANGES) {
    const url = BASE + '/' + encodeURIComponent(FONT_STACK) + '/' + range + '.pbf'
    try {
      const existing = await cache.match(url)
      if (existing) { stored++; continue }
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) continue
      await cache.put(url, response)
      stored++
    } catch {
      // The basemap must remain usable if optional glyph downloads fail.
    }
  }
  return { stored, total: RANGES.length }
}
