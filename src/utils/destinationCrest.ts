// v3 destination crest lookup, migrated from v2.7.0.
type CrestRecord = { destination: string; country: string; imageUrl: string }
const CACHE = 'travel-planner-offline-crests-v1'
const storageKey = (tripId: string) => 'travel-planner-v3-crest:' + tripId
const imageProxy = (imageUrl: string) => '/api/crest-image?url=' + encodeURIComponent(imageUrl)
const countries: Record<string,string> = { DE:'Q183',AT:'Q40',CH:'Q39',FR:'Q142',IT:'Q38',GB:'Q145',HU:'Q28',ES:'Q29',PL:'Q36',NL:'Q55',BE:'Q31',CZ:'Q213',LU:'Q32' }
async function query(host: string, params: Record<string,string>) {
  const url = new URL('/api/wikimedia', location.origin)
  url.searchParams.set('host', host)
  Object.entries(params).forEach(([key,value]) => url.searchParams.set(key,value))
  const response = await fetch(url, { cache:'no-store' })
  const data = await response.json()
  if (!response.ok || data.error) throw new Error('Wikimedia-Anfrage fehlgeschlagen')
  return data
}
export function readCrest(tripId: string): CrestRecord | null {
  try { return JSON.parse(localStorage.getItem(storageKey(tripId)) || 'null') as CrestRecord | null } catch { return null }
}
export async function lookupCrest(destination: string, country: string): Promise<string | null> {
  const results = await query('www.wikidata.org', {action:'wbsearchentities',search:destination,language:'de',uselang:'de',type:'item',limit:'20'})
  const candidates = (results.search || []).filter((item: {label?:string}) => String(item.label || '').localeCompare(destination,'de',{sensitivity:'base'}) === 0)
  if (!candidates.length) return null
  const entities = await query('www.wikidata.org', {action:'wbgetentities',ids:candidates.map((item: {id:string}) => item.id).join('|'),props:'claims|labels|descriptions'})
  const wanted = countries[country]
  const matching = candidates.map((item: {id:string;description?:string}) => {
    const claims = entities.entities?.[item.id]?.claims || {}
    const countryIds = (claims.P17 || []).map((c: any) => c.mainsnak?.datavalue?.value?.id)
    const filename = (claims.P94 || []).map((c: any) => c.mainsnak?.datavalue?.value).find((v: unknown) => typeof v === 'string' && v)
    const locality = /gemeinde|stadt|dorf|ortschaft|municipality|city|town|village|commune|district|borough/i.test(item.description || '')
    const countryMatch = !!wanted && countryIds.includes(wanted)
    return {filename, score:(countryMatch ? 100 : 0) + (locality ? 10 : 0), mismatch:!!wanted && countryIds.length > 0 && !countryMatch}
  }).filter((item: {filename?:string;mismatch:boolean}) => item.filename && !item.mismatch).sort((a: {score:number},b: {score:number}) => b.score-a.score)
  const filename = matching[0]?.filename
  if (!filename) return null
  const info = await query('commons.wikimedia.org', {action:'query',prop:'imageinfo',iiprop:'url',iiurlwidth:'96',titles:'File:'+filename})
  const page = Object.values(info.query?.pages || {})[0] as {imageinfo?:Array<{thumburl?:string;url?:string}>} | undefined
  return page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url || null
}
export async function prepareCrest(tripId: string, destination: string, country: string): Promise<string | null> {
  if (!destination) return null
  const previous = readCrest(tripId)
  const imageUrl = await lookupCrest(destination,country)
  if (!imageUrl) return null
  const response = await fetch(imageProxy(imageUrl), {cache:'reload'})
  if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) throw new Error('Wappenbild nicht verfügbar')
  const cache = await caches.open(CACHE)
  await cache.put(imageProxy(imageUrl), response.clone())
  localStorage.setItem(storageKey(tripId),JSON.stringify({destination,country,imageUrl}))
  if (previous?.imageUrl && previous.imageUrl !== imageUrl) await cache.delete(imageProxy(previous.imageUrl))
  return imageProxy(imageUrl)
}
export async function removeCrest(tripId: string) {
  const previous = readCrest(tripId)
  if (previous?.imageUrl) await (await caches.open(CACHE)).delete(imageProxy(previous.imageUrl))
  localStorage.removeItem(storageKey(tripId))
}
export function cachedCrestUrl(tripId: string, destination: string, country: string): string | null {
  const record = readCrest(tripId)
  return record?.destination === destination && record.country === country ? imageProxy(record.imageUrl) : null
}
