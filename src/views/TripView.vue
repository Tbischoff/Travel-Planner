<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTripStore } from '../stores/trip'
import { listTripDays, listTripPlaces, type TripDay, type TripPlace } from '../services/supabase/places'
import { geocodeDestination, getGoogleMaps, getMarkerLibrary, loadGoogleMaps, type AdvancedMarkerInstance, type InfoWindowInstance, type MapInstance } from '../services/google/maps'

const trips = useTripStore()
const auth = useAuthStore()
const router = useRouter()
const places = ref<TripPlace[]>([])
const tripDays = ref<TripDay[]>([])
const loading = ref(true)
const error = ref('')
const mapHost = ref<HTMLElement | null>(null)
const selectedCategory = ref('all')
const selectedDay = ref('unplanned')
const searchQuery = ref('')
const mobilePlacesOpen = ref(false)
const selectedPlaceId = ref<string | null>(null)
let map: MapInstance | null = null
let infoWindow: InfoWindowInstance | null = null
const markers = new Map<string, AdvancedMarkerInstance>()
const markerElements = new Map<string, HTMLElement>()
type ClusterPosition = { lat: number | (() => number); lng: number | (() => number) }
type ClusterMap = MapInstance & { setCenter: (position: { lat: number; lng: number }) => void }
type ClusterRendererInput = { count: number; position: ClusterPosition }
type MarkerClustererInstance = {
  clearMarkers: (noDraw?: boolean) => void
  addMarkers: (markers: AdvancedMarkerInstance[], noDraw?: boolean) => void
  render: () => void
}
type MarkerClustererConstructor = new (options: {
  map: MapInstance
  markers: AdvancedMarkerInstance[]
  renderer: { render: (cluster: ClusterRendererInput, stats: unknown, map: ClusterMap) => AdvancedMarkerInstance }
  onClusterClick: null
}) => MarkerClustererInstance
type MarkerClustererWindow = Window & {
  markerClusterer?: { MarkerClusterer?: MarkerClustererConstructor }
}

let placeMarkerClusterer: MarkerClustererInstance | null = null

const visiblePlaces = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('de')
  return places.value.filter((place) => {
    const categoryMatches = selectedCategory.value === 'all' || (place.category || 'other') === selectedCategory.value
    const searchMatches = !query || [place.name, place.address, place.note]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('de').includes(query))
    return categoryMatches && searchMatches
  })
})
const categories = computed(() => [...new Set(places.value.map(place => place.category || 'other'))].sort())


function label(category: string) {
  return ({ food:'Essen', cafe:'Café', bar:'Bar', sight:'Sehenswürdigkeit', culture:'Kultur', leisure:'Freizeit', thermal:'Thermalbad', viewpoint:'Aussicht', transport:'Verkehr', area:'Gebiet', hotel:'Unterkunft', other:'Sonstiges' } as Record<string,string>)[category] || category
}

const categoryIcons: Record<string,string> = { food:'🍴', cafe:'☕', bar:'🍸', sight:'🏛️', culture:'🎭', leisure:'🌳', thermal:'♨️', viewpoint:'🌇', transport:'🚇', area:'📍', hotel:'🏨', other:'•' }
const markerColors: Record<string,string> = { food:'#f97316', cafe:'#a16207', bar:'#7c3aed', sight:'#2563eb', culture:'#db2777', leisure:'#16a34a', thermal:'#0891b2', viewpoint:'#ca8a04', transport:'#475569', area:'#dc2626', hotel:'#0f766e', other:'#64748b' }

function markerContent(place: TripPlace) {
  const category = place.category || 'other'
  const marker = document.createElement('div')
  marker.className = 'v3-place-marker'
  marker.dataset.placeId = place.id
  marker.style.setProperty('--marker-color', markerColors[category] || markerColors.other)
  const concreteDaySelected = tripDays.value.some(day => day.day_date === selectedDay.value)
  const isInSelectedDay = concreteDaySelected && place.planned_day === selectedDay.value
  if (place.visited) marker.classList.add('v3-place-marker--visited')
  if (place.category === 'hotel') marker.classList.add('v3-place-marker--hotel')
  if (place.is_local_tip) marker.classList.add('v3-place-marker--tip')
  if (isInSelectedDay) marker.classList.add('v3-place-marker--day-stop')
  else if (concreteDaySelected && place.category !== 'hotel') marker.classList.add('v3-place-marker--day-muted')
  marker.title = place.name

  const pin = document.createElement('span')
  pin.className = 'v3-place-marker__pin'
  const icon = document.createElement('span')
  icon.className = 'v3-place-marker__icon'
  if (isInSelectedDay) {
    icon.classList.add('v3-place-marker__order')
    icon.textContent = String(place.planned_order || '')
  } else {
    icon.innerHTML = markerSvg(category)
  }
  pin.appendChild(icon)

  const name = document.createElement('span')
  name.className = 'v3-place-marker__label'
  name.textContent = place.name
  marker.append(pin, name)
  markerElements.set(place.id, marker)
  return marker
}

function markerSvg(category: string) {
  const icons: Record<string,string> = {
    food: '<path d="M7 3v7M10 3v7M7 7h3M8.5 10v11M16 3v18M16 3c3 2 3 7 0 9"/>',
    cafe: '<path d="M5 8h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8Zm11 2h2a3 3 0 0 1 0 6h-3M7 4h8"/>',
    bar: '<path d="M5 4h14l-6 8v6M9 21h8M7 8h10"/>',
    sight: '<path d="M4 9h16M6 9v9M10 9v9M14 9v9M18 9v9M3 20h18M12 3l9 4H3l9-4Z"/>',
    culture: '<path d="M4 5c3-2 5 0 8 0s5-2 8 0v8c0 5-4 8-8 9-4-1-8-4-8-9V5Zm3 5h3M14 10h3M9 15c2 2 4 2 6 0"/>',
    leisure: '<path d="M12 21V10M12 10c-4 0-7-2-8-6 4 0 7 2 8 6Zm0 4c4 0 7-2 8-6-4 0-7 2-8 6Z"/>',
    thermal: '<path d="M7 4c-2 2 2 3 0 5s2 3 0 5M12 4c-2 2 2 3 0 5s2 3 0 5M17 4c-2 2 2 3 0 5s2 3 0 5M4 19h16"/>',
    viewpoint: '<path d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5Zm9-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
    transport: '<path d="M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-1 8h12M8 21l2-3M16 21l-2-3M8 7h8"/>',
    area: '<path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>',
    hotel: '<path d="M4 19V6M4 14h16v5M7 10h5a3 3 0 0 1 3 3v1M7 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>',
    other: '<circle cx="12" cy="12" r="3"/>',
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icons[category] || icons.other) + '</svg>'
}
function refreshMarkerAppearances() {
  for (const place of places.value) {
    const current = markerElements.get(place.id)
    const marker = markers.get(place.id)
    if (!current || !marker) continue
    const replacement = markerContent(place)
    current.replaceWith(replacement)
    marker.content = replacement
    marker.zIndex = place.category === 'hotel' ? 900 :
      (tripDays.value.some(day => day.day_date === selectedDay.value) && place.planned_day === selectedDay.value)
        ? 500 + (place.planned_order || 0)
        : place.is_local_tip ? 100 : 1
  }
  syncSelectedMarker()
  syncMarkerVisibility()
}

function syncSelectedMarker() {
  for (const [id, element] of markerElements) {
    element.classList.toggle('v3-place-marker--selected', id === selectedPlaceId.value)
  }
}

function infoHtml(place: TripPlace) {
  return '<div class="v3-map-info"><strong>' + escapeHtml(place.name) + '</strong><div>' +
    escapeHtml(categoryIcons[place.category || 'other'] + ' ' + label(place.category || 'other') + (place.is_local_tip ? ' · ⭐ Local-Tipp' : '')) +
    '</div><div>' + escapeHtml(place.address || '') + '</div>' +
    (place.note ? '<div style="margin-top:6px">' + escapeHtml(place.note) + '</div>' : '') + '</div>'
}

function openPlace(place: TripPlace, focus = false) {
  if (!map) return
  const marker = markers.get(place.id)
  if (!marker) return
  selectedPlaceId.value = place.id
  syncSelectedMarker()
  infoWindow?.close()
  infoWindow?.setContent(infoHtml(place))
  infoWindow?.open({ map, anchor: marker })
  if (focus && place.latitude != null && place.longitude != null) {
    map.panTo({ lat: Number(place.latitude), lng: Number(place.longitude) })
    map.setZoom(Math.max(map.getZoom() || 0, 16))
  }
}

function createClusterMarker({ count, position }: ClusterRendererInput, _stats: unknown, clusterMap: ClusterMap) {
  const element = document.createElement('div')
  element.className = 'v3-marker-cluster'
  element.textContent = String(count)
  element.setAttribute('aria-label', count + ' Orte in diesem Bereich')
  const { AdvancedMarkerElement } = getMarkerLibrarySync()
  const clusterMarker = new AdvancedMarkerElement({
    position, content: element, zIndex: 1000 + Number(count || 0),
    title: count + ' Orte', gmpClickable: true,
  })
  clusterMarker.addEventListener('gmp-click', () => {
    if (!clusterMap || !position) return
    const lat = typeof position.lat === 'function' ? position.lat() : position.lat
    const lng = typeof position.lng === 'function' ? position.lng() : position.lng
    clusterMap.setCenter({ lat, lng })
    clusterMap.setZoom(Math.min((Number(clusterMap.getZoom()) || 0) + 2, 20))
  })
  return clusterMarker
}

function syncMarkerVisibility() {
  const visibleIds = new Set(visiblePlaces.value.map((place) => place.id))
  const visibleMarkers: AdvancedMarkerInstance[] = []
  for (const [id, marker] of markers) {
    marker.map = null
    if (visibleIds.has(id)) visibleMarkers.push(marker)
  }
  if (placeMarkerClusterer) {
    placeMarkerClusterer.clearMarkers(true)
    placeMarkerClusterer.addMarkers(visibleMarkers, true)
    placeMarkerClusterer.render()
  } else {
    for (const marker of visibleMarkers) marker.map = map
  }
  if (selectedPlaceId.value && !visibleIds.has(selectedPlaceId.value)) {
    selectedPlaceId.value = null
    syncSelectedMarker()
    infoWindow?.close()
  }
}

async function restoreTrip() {
  if (trips.currentTrip) return
  if (!auth.user) return
  await trips.load(auth.user.id)
  const remembered = localStorage.getItem('travelPlannerLastTripId')
  const trip = trips.trips.find(item => item.id === remembered)
  if (trip) trips.select(trip)
}

function getMarkerLibrarySync() {
  const googleWithMarker = window.google as unknown as {
    maps: { marker: { AdvancedMarkerElement: new (options: Record<string, unknown>) => AdvancedMarkerInstance } }
  }
  return googleWithMarker.maps.marker
}

async function renderMap() {
  if (!trips.currentTrip || !mapHost.value) return
  await loadGoogleMaps()
  let center = { lat: 50.1109, lng: 8.6821 }
  try { center = await geocodeDestination(trips.currentTrip.destination) } catch { /* fallback */ }
  const googleMaps = getGoogleMaps()
  const { AdvancedMarkerElement } = await getMarkerLibrary()
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID
  if (!mapId) throw new Error('Google-Maps-Karten-ID fehlt.')
  map = new googleMaps.Map(mapHost.value, {
    center, zoom: 12, mapId, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
  })
  infoWindow = new googleMaps.InfoWindow({ disableAutoPan: true })
  const MarkerClusterer = (window as MarkerClustererWindow).markerClusterer?.MarkerClusterer
  if (MarkerClusterer) {
    placeMarkerClusterer = new MarkerClusterer({
      map,
      markers: [],
      renderer: { render: createClusterMarker },
      onClusterClick: null,
    })
  }
  const bounds = new googleMaps.LatLngBounds()
  let markerCount = 0
  for (const place of places.value) {
    if (place.latitude == null || place.longitude == null) continue
    const position = { lat: Number(place.latitude), lng: Number(place.longitude) }
    const marker = new AdvancedMarkerElement({
      map, position, title: place.name, content: markerContent(place), gmpClickable: true,
      zIndex: place.category === 'hotel' ? 900 : place.is_local_tip ? 100 : 1,
    })
    marker.addEventListener('gmp-click', () => openPlace(place))
    markers.set(place.id, marker)
    bounds.extend(position)
    markerCount++
  }
  if (markerCount) map.fitBounds(bounds, 56)
  syncMarkerVisibility()
}

watch(visiblePlaces, () => syncMarkerVisibility())
watch(selectedDay, () => refreshMarkerAppearances())

function escapeHtml(value: string) {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}

onMounted(async () => {
  try {
    await restoreTrip()
    if (!trips.currentTrip) { await router.replace('/trips'); return }
    ;[places.value, tripDays.value] = await Promise.all([listTripPlaces(trips.currentTrip.id), listTripDays(trips.currentTrip.id)])
    await nextTick()
    await renderMap()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Orte konnten nicht geladen werden.'
  } finally { loading.value = false }
})
</script>

<template>
  <main class="trip-workspace">
    <header class="trip-header" :class="{ 'trip-header--mobile-hidden': mobilePlacesOpen }">
      <div><p class="auth-card__eyebrow">Travel Planner v3 · Orte & Karte</p><h1>{{ trips.currentTrip?.name }}</h1><p>{{ trips.currentTrip?.destination }} · {{ places.length }} Orte</p></div>
      <button class="secondary-button" @click="router.push('/trips')">Reisen</button>
    </header>
    <p v-if="error" class="trip-error">{{ error }}</p>
    <section class="trip-map-layout" :class="{ 'trip-map-layout--places-open': mobilePlacesOpen }">
      <aside class="places-panel" :class="{ 'places-panel--open': mobilePlacesOpen }">
        <div class="mobile-sheet-handle" aria-hidden="true"></div>
        <div class="mobile-panel-head">
          <strong>Orte entdecken</strong>
          <button type="button" class="mobile-close" @click="mobilePlacesOpen = false">✕</button>
        </div>
        <div class="places-panel__heading">
          <h2>Orte <span class="count-badge">{{ visiblePlaces.length }} / {{ places.length }}</span></h2>
        </div>
        <input v-model="searchQuery" class="place-search" type="search" placeholder="Orte durchsuchen …">
        <div class="places-panel__toolbar">
          <select v-model="selectedCategory" aria-label="Kategorie filtern">
            <option value="all">Alle Kategorien</option>
            <option v-for="category in categories" :key="category" :value="category">{{ label(category) }}</option>
          </select>
          <select v-model="selectedDay" aria-label="Tag hervorheben">
            <option value="unplanned">Noch offen</option>
            <option v-for="day in tripDays" :key="day.id" :value="day.day_date">{{ new Date(day.day_date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) }}</option>
          </select>
        </div>
        <p v-if="loading">Orte werden geladen …</p>
        <p v-else-if="!visiblePlaces.length" class="muted">Keine Orte in dieser Auswahl.</p>
        <button v-for="place in visiblePlaces" :key="place.id" class="place-row" :class="{ 'place-row--active': selectedPlaceId === place.id }" type="button" @click="openPlace(place, true); mobilePlacesOpen = false">
          <span class="place-row__content">
            <span class="place-row__title"><strong>{{ place.name }}</strong><span v-if="place.visited" class="badge">Besucht</span></span>
            <small class="place-row__meta">{{ label(place.category || 'other') }}<template v-if="place.address"> · {{ place.address }}</template></small>
            <small v-if="place.note" class="place-row__note">{{ place.note }}</small>
          </span>
        </button>
      </aside>
      <section class="map-panel">
        <div class="map-mobile-actions">
          <button type="button" @click="mobilePlacesOpen = true">☰ Orte <span>{{ visiblePlaces.length }}</span></button>
          <button type="button" class="map-mobile-trips" @click="router.push('/trips')" aria-label="Reise wechseln">Reisen</button>
        </div>
        <div ref="mapHost" class="trip-map" aria-label="Karte der Reise"></div></section>
    </section>
  </main>
</template>

<style scoped>
.trip-workspace{min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;background:#f6f7f9}.trip-header{max-width:1400px;margin:0 auto 18px;display:flex;align-items:center;justify-content:space-between;gap:16px}.trip-header h1{margin:4px 0}.trip-header p{margin:0}.trip-map-layout{max-width:1400px;margin:auto;display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:16px;height:calc(100vh - 150px);min-height:560px}.places-panel,.map-panel{background:#fff;border:1px solid #dde2e8;border-radius:18px;overflow:hidden}.places-panel{padding:16px;overflow:auto}.places-panel__heading h2{margin:0 0 10px;display:flex;align-items:center;gap:8px}.count-badge{font-size:.72rem;color:#65717d;background:#f2f4f7;border:1px solid #e1e5ea;border-radius:999px;padding:3px 8px}.place-search{box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border:1px solid #d8dee6;border-radius:11px;background:#f8f9fb;color:inherit;font:inherit}.places-panel__toolbar{margin-bottom:12px;display:grid;gap:8px}.places-panel__toolbar select{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d8dee6;border-radius:10px;background:#fff}.trip-workspace button,.trip-workspace select{font:inherit}.trip-workspace button{font-weight:700}.place-row{width:100%;display:block;text-align:left;padding:10px 11px;margin:0 0 7px;background:#f8f9fb;border:1px solid #e1e5ea;border-radius:12px;color:inherit;cursor:pointer;transition:transform .12s ease,border-color .12s ease,background .12s ease}.place-row:hover{transform:translateY(-1px);border-color:#c7ced7;background:#fff}.place-row--active{border-color:#2f625d;background:#fff;box-shadow:0 0 0 2px rgba(47,98,93,.08)}.place-row__content{display:block;min-width:0}.place-row__title{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.place-row strong{font-size:.9rem}.place-row small{display:block;overflow-wrap:anywhere}.place-row__meta{margin-top:4px;color:#65717d;font-size:.75rem}.place-row__note{margin-top:6px;color:#56616d;font-size:.75rem;line-height:1.35}.place-row .badge{margin:0;flex:0 0 auto;font-size:.68rem}.map-panel{position:relative}.trip-map{width:100%;height:100%;min-height:500px}.trip-error{max-width:1400px;margin:0 auto 16px;color:#a21d1d}.muted{color:#65717d}.mobile-sheet-handle,.mobile-panel-head,.map-mobile-actions{display:none}
:global(.v3-place-marker){position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;transform:translateY(-4px);isolation:isolate}
:global(.v3-place-marker__pin){position:relative;width:36px;height:36px;display:grid;place-items:center;border:3px solid #fff;border-radius:50%;background:var(--marker-color,#64748b);box-shadow:0 2px 7px rgba(15,23,42,.32);transition:transform .14s ease,box-shadow .14s ease}
:global(.v3-place-marker__icon){display:grid;place-items:center;width:20px;height:20px;color:#fff}
:global(.v3-place-marker__icon svg){width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
:global(.v3-place-marker__label){position:absolute;left:50%;top:44px;max-width:190px;padding:5px 8px;border:1px solid rgba(15,23,42,.12);border-radius:7px;background:rgba(255,255,255,.97);box-shadow:0 2px 8px rgba(15,23,42,.15);color:#172033;font:700 11px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transform:translateX(-50%)}
:global(.v3-place-marker--tip .v3-place-marker__pin){transform:scale(1.12);box-shadow:0 2px 8px rgba(15,23,42,.34)}
:global(.v3-place-marker--hotel .v3-place-marker__pin){width:40px;height:40px}
:global(.v3-place-marker--day-stop .v3-place-marker__pin){background:#2f625d;transform:scale(1.16);border-radius:12px}
:global(.v3-place-marker__order){font-size:15px;font-weight:800;color:#fff}
:global(.v3-place-marker--day-muted){opacity:.35;transform:translateY(-4px) scale(.92)}
:global(.v3-place-marker--day-stop.v3-place-marker--visited){opacity:.42;filter:none}
:global(.v3-place-marker--hotel){opacity:1;filter:none}
:global(.v3-place-marker--selected){z-index:1100!important}
:global(.v3-place-marker--selected .v3-place-marker__pin){transform:scale(1.14);box-shadow:0 0 0 4px rgba(255,255,255,.95),0 4px 12px rgba(15,23,42,.42)}
:global(.v3-place-marker--selected .v3-place-marker__label){opacity:1}
:global(.v3-place-marker--visited){opacity:.5;filter:saturate(.45)}
:global(.v3-place-marker--visited.v3-place-marker--selected){opacity:1;filter:none}
:global(.v3-marker-cluster){min-width:38px;height:38px;padding:0 10px;border:3px solid rgba(255,255,255,.96);border-radius:999px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;background:#2f625d;color:#fff;font:700 14px/1 Inter,ui-sans-serif,system-ui,sans-serif;box-shadow:0 3px 10px rgba(15,23,42,.28);transform:translateY(-2px);user-select:none;cursor:pointer}
:global(.v3-map-info){font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:260px;line-height:1.4}
:global(.v3-map-info strong){display:block;margin-bottom:4px;font-size:15px}
@media(max-width:760px){
.trip-workspace{padding:0;background:#fff;overflow:hidden}.trip-header{display:none}.trip-map-layout{display:block;height:100dvh;min-height:0;margin:0}.map-panel{height:100dvh;border:0;border-radius:0}.trip-map{height:100dvh;min-height:0}.map-mobile-actions{display:flex;position:absolute;left:12px;right:12px;top:12px;z-index:4;gap:8px}.map-mobile-trips{margin-left:auto}.map-mobile-actions button{border:1px solid rgba(0,0,0,.1);border-radius:12px;background:rgba(255,255,255,.96);padding:10px 13px;box-shadow:0 5px 18px rgba(0,0,0,.15);color:#172033}.map-mobile-actions span{margin-left:5px;color:#65717d}.places-panel{display:block;position:fixed;z-index:20;inset:0 auto 0 0;width:min(90vw,390px);box-sizing:border-box;border:0;border-radius:0 18px 18px 0;padding:12px 16px 20px;background:#fff;box-shadow:12px 0 34px rgba(0,0,0,.18);transform:translateX(-105%);transition:transform .2s ease;overflow-y:auto}.places-panel--open{transform:translateX(0)}.mobile-sheet-handle{display:block;width:42px;height:4px;margin:0 auto 12px;border-radius:999px;background:#d2d7dd}.mobile-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;font-size:1.08rem}.mobile-close{border:0;background:transparent;font-size:1.15rem;padding:6px;color:#34404c}.places-panel__heading h2{font-size:1rem;margin-bottom:10px}.place-row{padding:10px}.trip-error{position:fixed;z-index:30;left:12px;right:12px;top:12px;background:#fff;padding:10px;border-radius:10px}}
</style>
