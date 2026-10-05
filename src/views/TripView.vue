<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTripStore } from '../stores/trip'
import { listTripPlaces, type TripPlace } from '../services/supabase/places'
import { geocodeDestination, getGoogleMaps, loadGoogleMaps } from '../services/google/maps'

const trips = useTripStore()
const auth = useAuthStore()
const router = useRouter()
const places = ref<TripPlace[]>([])
const loading = ref(true)
const error = ref('')
const mapHost = ref<HTMLElement | null>(null)
const selectedCategory = ref('all')
const searchQuery = ref('')

const visiblePlaces = computed(() => selectedCategory.value === 'all'
  ? places.value
  : places.value.filter(place => (place.category || 'other') === selectedCategory.value))
const categories = computed(() => [...new Set(places.value.map(place => place.category || 'other'))].sort())

function label(category: string) {
  return ({ food:'Essen', cafe:'Café', bar:'Bar', sight:'Sehenswürdigkeit', culture:'Kultur', leisure:'Freizeit', thermal:'Thermalbad', viewpoint:'Aussicht', transport:'Verkehr', area:'Gebiet', hotel:'Unterkunft', other:'Sonstiges' } as Record<string,string>)[category] || category
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
  const map = new googleMaps.Map(mapHost.value, {
    center, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
  })
  const bounds = new googleMaps.LatLngBounds()
  let markerCount = 0
  for (const place of places.value) {
    if (place.latitude == null || place.longitude == null) continue
    const position = { lat: Number(place.latitude), lng: Number(place.longitude) }
    const marker = new googleMaps.Marker({ map, position, title: place.name })
    const info = new googleMaps.InfoWindow({
      content: '<div class="v3-map-info"><strong>' + escapeHtml(place.name) + '</strong><br>' + escapeHtml(place.address || '') + '</div>'
    })
    marker.addListener('click', () => info.open({ map, anchor: marker }))
    bounds.extend(position)
    markerCount++
  }
  if (markerCount) map.fitBounds(bounds, 56)
}

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
    <header class="trip-header">
      <div><p class="auth-card__eyebrow">Travel Planner v3 · Orte & Karte</p><h1>{{ trips.currentTrip?.name }}</h1><p>{{ trips.currentTrip?.destination }} · {{ places.length }} Orte</p></div>
      <button class="secondary-button" @click="router.push('/trips')">Reisen</button>
    </header>
    <p v-if="error" class="trip-error">{{ error }}</p>
    <section class="trip-map-layout">
      <aside class="places-panel">
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
        <button v-for="place in visiblePlaces" :key="place.id" class="place-row" type="button">
          <span class="place-row__content">
            <span class="place-row__title"><strong>{{ place.name }}</strong><span v-if="place.visited" class="badge">Besucht</span></span>
            <small class="place-row__meta">{{ label(place.category || 'other') }}<template v-if="place.address"> · {{ place.address }}</template></small>
            <small v-if="place.note" class="place-row__note">{{ place.note }}</small>
          </span>
        </button>
      </aside>
      <section class="map-panel"><div ref="mapHost" class="trip-map" aria-label="Karte der Reise"></div></section>
    </section>
  </main>
</template>

<style scoped>
.trip-workspace{min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;background:#f6f7f9}.trip-header{max-width:1400px;margin:0 auto 18px;display:flex;align-items:center;justify-content:space-between;gap:16px}.trip-header h1{margin:4px 0}.trip-header p{margin:0}.trip-map-layout{max-width:1400px;margin:auto;display:grid;grid-template-columns:minmax(280px,360px) 1fr;gap:16px;height:calc(100vh - 150px);min-height:560px}.places-panel,.map-panel{background:white;border:1px solid #dde2e8;border-radius:18px;overflow:hidden}.places-panel{padding:16px;overflow:auto}.places-panel__heading h2{margin:0 0 10px;display:flex;align-items:center;gap:8px}.count-badge{font-size:.72rem;color:#65717d;background:#f2f4f7;border:1px solid #e1e5ea;border-radius:999px;padding:3px 8px}.place-search{width:100%;padding:11px 12px;margin-bottom:10px;border:1px solid #d8dee6;border-radius:11px;background:#f8f9fb;color:inherit;font:inherit}.places-panel__toolbar{margin-bottom:12px}.places-panel__toolbar select{width:100%;padding:9px 10px;border:1px solid #d8dee6;border-radius:10px;background:#fff}.trip-workspace button,.trip-workspace select{font:inherit}.trip-workspace button{font-weight:700}.place-row{width:100%;display:block;text-align:left;padding:10px 11px;margin:0 0 7px;background:#f8f9fb;border:1px solid #e1e5ea;border-radius:12px;color:inherit;cursor:pointer;transition:transform .12s ease,border-color .12s ease,background .12s ease}.place-row:hover{transform:translateY(-1px);border-color:#c7ced7;background:#fff}.place-row__content{display:block;min-width:0}.place-row__title{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.place-row strong{font-size:.9rem}.place-row small{display:block;overflow-wrap:anywhere}.place-row__meta{margin-top:4px;color:#65717d;font-size:.75rem}.place-row__note{margin-top:6px;color:#56616d;font-size:.75rem;line-height:1.35}.place-row .badge{margin:0;flex:0 0 auto;font-size:.68rem}.trip-map{width:100%;height:100%;min-height:500px}.trip-error{max-width:1400px;margin:0 auto 16px;color:#a21d1d}.muted{color:#65717d}@media(max-width:760px){.trip-workspace{padding:12px}.trip-header{align-items:flex-start}.trip-map-layout{display:flex;flex-direction:column;height:auto}.places-panel{max-height:38vh}.map-panel,.trip-map{height:52vh;min-height:380px}}
</style>
