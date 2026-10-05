<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTripStore } from '../stores/trip'
import { listTripPlaces, type TripPlace } from '../services/supabase/places'
import { geocodeDestination, getGoogleMaps, getMarkerLibrary, loadGoogleMaps, type AdvancedMarkerInstance, type InfoWindowInstance, type MapInstance } from '../services/google/maps'

const trips = useTripStore()
const auth = useAuthStore()
const router = useRouter()
const places = ref<TripPlace[]>([])
const loading = ref(true)
const error = ref('')
const mapHost = ref<HTMLElement | null>(null)
const selectedCategory = ref('all')
const searchQuery = ref('')
const mobilePlacesOpen = ref(false)
const selectedPlaceId = ref<string | null>(null)
let map: MapInstance | null = null
let infoWindow: InfoWindowInstance | null = null
const markers = new Map<string, AdvancedMarkerInstance>()

const visiblePlaces = computed(() => selectedCategory.value === 'all'
  ? places.value
  : places.value.filter(place => (place.category || 'other') === selectedCategory.value))
const categories = computed(() => [...new Set(places.value.map(place => place.category || 'other'))].sort())

function label(category: string) {
  return ({ food:'Essen', cafe:'Café', bar:'Bar', sight:'Sehenswürdigkeit', culture:'Kultur', leisure:'Freizeit', thermal:'Thermalbad', viewpoint:'Aussicht', transport:'Verkehr', area:'Gebiet', hotel:'Unterkunft', other:'Sonstiges' } as Record<string,string>)[category] || category
}

const categoryIcons: Record<string,string> = { food:'🍴', cafe:'☕', bar:'🍸', sight:'🏛️', culture:'🎭', leisure:'🌳', thermal:'♨️', viewpoint:'🌇', transport:'🚇', area:'📍', hotel:'🏨', other:'•' }
const markerColors: Record<string,string> = { food:'#f97316', cafe:'#a16207', bar:'#7c3aed', sight:'#2563eb', culture:'#db2777', leisure:'#16a34a', thermal:'#0891b2', viewpoint:'#ca8a04', transport:'#475569', area:'#dc2626', hotel:'#0f766e', other:'#64748b' }

function markerContent(place: TripPlace) {
  const pin = document.createElement('div')
  pin.className = 'v3-place-marker'
  pin.style.background = markerColors[place.category || 'other'] || markerColors.other
  pin.style.opacity = place.visited ? '0.42' : '1'
  pin.style.transform = place.is_local_tip ? 'scale(1.12)' : 'scale(1)'
  pin.textContent = place.category === 'hotel' ? '🏨' : place.is_local_tip ? '★' : (categoryIcons[place.category || 'other'] || '•')
  pin.title = place.name
  return pin
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
  infoWindow?.close()
  infoWindow?.setContent(infoHtml(place))
  infoWindow?.open({ map, anchor: marker })
  if (focus && place.latitude != null && place.longitude != null) {
    map.panTo({ lat: Number(place.latitude), lng: Number(place.longitude) })
    map.setZoom(Math.max(map.getZoom() || 0, 16))
  }
}

function syncMarkerVisibility() {
  const visibleIds = new Set(visiblePlaces.value.map((place) => place.id))
  for (const [id, marker] of markers) marker.map = visibleIds.has(id) ? map : null
  if (selectedPlaceId.value && !visibleIds.has(selectedPlaceId.value)) {
    selectedPlaceId.value = null
    infoWindow?.close()
  }

async function restoreTrip() {
  if (trips.currentTrip) return
  if (!auth.user) return
  await trips.load(auth.user.id)
  const remembered = localStorage.getItem('travelPlannerLastTripId')
  const trip = trips.trips.find(item => item.id === remembered)
  if (trip) trips.select(trip)
}

async function renderMap() {
  if (!trips.currentTrip || !mapHost.value) return
  await loadGoogleMaps()
  let center = { lat: 50.1109, lng: 8.6821 }
  try { center = await geocodeDestination(trips.currentTrip.destination) } catch { /* fallback */ }
  const googleMaps = getGoogleMaps()
  const { AdvancedMarkerElement } = await getMarkerLibrary()
  map = new googleMaps.Map(mapHost.value, {
    center, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
  })
  infoWindow = new googleMaps.InfoWindow({ disableAutoPan: true })
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

function escapeHtml(value: string) {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}

onMounted(async () => {
  try {
    await restoreTrip()
    if (!trips.currentTrip) { await router.replace('/trips'); return }
    places.value = await listTripPlaces(trips.currentTrip.id)
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
        </div>
        <div ref="mapHost" class="trip-map" aria-label="Karte der Reise"></div></section>
    </section>
  </main>
</template>

<style scoped>
.trip-workspace{min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;background:#f6f7f9}.trip-header{max-width:1400px;margin:0 auto 18px;display:flex;align-items:center;justify-content:space-between;gap:16px}.trip-header h1{margin:4px 0}.trip-header p{margin:0}.trip-map-layout{max-width:1400px;margin:auto;display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:16px;height:calc(100vh - 150px);min-height:560px}.places-panel,.map-panel{background:#fff;border:1px solid #dde2e8;border-radius:18px;overflow:hidden}.places-panel{padding:16px;overflow:auto}.places-panel__heading h2{margin:0 0 10px;display:flex;align-items:center;gap:8px}.count-badge{font-size:.72rem;color:#65717d;background:#f2f4f7;border:1px solid #e1e5ea;border-radius:999px;padding:3px 8px}.place-search{box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border:1px solid #d8dee6;border-radius:11px;background:#f8f9fb;color:inherit;font:inherit}.places-panel__toolbar{margin-bottom:12px}.places-panel__toolbar select{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d8dee6;border-radius:10px;background:#fff}.trip-workspace button,.trip-workspace select{font:inherit}.trip-workspace button{font-weight:700}.place-row{width:100%;display:block;text-align:left;padding:10px 11px;margin:0 0 7px;background:#f8f9fb;border:1px solid #e1e5ea;border-radius:12px;color:inherit;cursor:pointer;transition:transform .12s ease,border-color .12s ease,background .12s ease}.place-row:hover{transform:translateY(-1px);border-color:#c7ced7;background:#fff}.place-row--active{border-color:#2f625d;background:#fff;box-shadow:0 0 0 2px rgba(47,98,93,.08)}.place-row__content{display:block;min-width:0}.place-row__title{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.place-row strong{font-size:.9rem}.place-row small{display:block;overflow-wrap:anywhere}.place-row__meta{margin-top:4px;color:#65717d;font-size:.75rem}.place-row__note{margin-top:6px;color:#56616d;font-size:.75rem;line-height:1.35}.place-row .badge{margin:0;flex:0 0 auto;font-size:.68rem}.map-panel{position:relative}.trip-map{width:100%;height:100%;min-height:500px}.trip-error{max-width:1400px;margin:0 auto 16px;color:#a21d1d}.muted{color:#65717d}.mobile-sheet-handle,.mobile-panel-head,.map-mobile-actions{display:none}
:global(.v3-place-marker){width:32px;height:32px;border:2px solid #fff;border-radius:50% 50% 50% 0;display:grid;place-items:center;color:#fff;font-size:15px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,.28);transform:rotate(-45deg);transform-origin:50% 70%}
:global(.v3-place-marker)::first-letter{transform:rotate(45deg)}
:global(.v3-map-info){font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:260px;line-height:1.4}
:global(.v3-map-info strong){display:block;margin-bottom:4px;font-size:15px}
@media(max-width:760px){
.trip-workspace{padding:0;background:#fff;overflow:hidden}.trip-header{display:none}.trip-map-layout{display:block;height:100dvh;min-height:0;margin:0}.map-panel{height:100dvh;border:0;border-radius:0}.trip-map{height:100dvh;min-height:0}.map-mobile-actions{display:flex;position:absolute;left:12px;top:12px;z-index:4}.map-mobile-actions button{border:1px solid rgba(0,0,0,.1);border-radius:12px;background:rgba(255,255,255,.96);padding:10px 13px;box-shadow:0 5px 18px rgba(0,0,0,.15);color:#172033}.map-mobile-actions span{margin-left:5px;color:#65717d}.places-panel{display:block;position:fixed;z-index:20;inset:0 auto 0 0;width:min(90vw,390px);box-sizing:border-box;border:0;border-radius:0 18px 18px 0;padding:12px 16px 20px;background:#fff;box-shadow:12px 0 34px rgba(0,0,0,.18);transform:translateX(-105%);transition:transform .2s ease;overflow-y:auto}.places-panel--open{transform:translateX(0)}.mobile-sheet-handle{display:block;width:42px;height:4px;margin:0 auto 12px;border-radius:999px;background:#d2d7dd}.mobile-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;font-size:1.08rem}.mobile-close{border:0;background:transparent;font-size:1.15rem;padding:6px;color:#34404c}.places-panel__heading h2{font-size:1rem;margin-bottom:10px}.place-row{padding:10px}.trip-error{position:fixed;z-index:30;left:12px;right:12px;top:12px;background:#fff;padding:10px;border-radius:10px}}
</style>
