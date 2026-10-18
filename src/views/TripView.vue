<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { openingStatus } from '../utils/openingStatus'
import { supabase } from '../services/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useAuthStore } from '../stores/auth'
import { useTripStore } from '../stores/trip'
import { addTripPlace, deleteTripPlace, listTripDays, listTripPlaces, updatePlaceDetails, updateTripPlacePlanning, updateTripPlaceStay, type TripDay, type TripPlace } from '../services/supabase/places'
import { geocodeDestination, getGoogleMaps, getMarkerLibrary, getPlacesLibrary, loadGoogleMaps, type AdvancedMarkerInstance, type InfoWindowInstance, type MapInstance } from '../services/google/maps'

const trips = useTripStore()
const auth = useAuthStore()
const router = useRouter()
const places = ref<TripPlace[]>([])
const tripDays = ref<TripDay[]>([])
type Activity = { id: string; trip_day_id: string; name: string; start_time: string | null; end_time: string | null; meeting_place_name: string | null; note: string | null; planned_order: number | null; address: string | null; google_place_id: string | null; latitude: number | null; longitude: number | null }
const activities = ref<Activity[]>([])
const activityName = ref('')
const activityStart = ref('')
const activityMeeting = ref('')
const activityDayId = ref('')
const activityError = ref('')
const activitySaving = ref(false)
const activityOpen = ref(false)
const editingActivityId = ref<string | null>(null)
async function deleteActivity() {
  const trip = trips.currentTrip
  if (!trip || !editingActivityId.value || !trips.canEditContent || !confirm('Aktivität wirklich löschen?')) return
  activitySaving.value = true
  try {
    const { error } = await supabase.from('trip_activities').delete().eq('id',editingActivityId.value).eq('trip_id',trip.id)
    if (error) throw error
    await loadActivities()
    activityOpen.value = false
  } catch (e) { activityError.value = e instanceof Error ? e.message : 'Löschen fehlgeschlagen.' }
  finally { activitySaving.value = false }
}
const activityPlaceHost = ref<HTMLElement | null>(null)
const activityPlaceError = ref('')
const activityAddress = ref('')
const activityGooglePlaceId = ref<string | null>(null)
const activityLatitude = ref<number | null>(null)
const activityLongitude = ref<number | null>(null)
async function openActivityDialog(activity?: Activity) {
  if (!trips.canEditContent) return
  editingActivityId.value = activity?.id || null
  activityName.value = activity?.name || ''
  activityStart.value = activity?.start_time?.slice(0,5) || ''
  activityMeeting.value = activity?.meeting_place_name || ''
  activityDayId.value = activity?.trip_day_id || selectedDayRecord.value?.id || tripDays.value[0]?.id || ''
  activityPlaceError.value = ''
  activityAddress.value = activity?.address || ''
  activityGooglePlaceId.value = activity?.google_place_id || null
  activityLatitude.value = activity?.latitude ?? null
  activityLongitude.value = activity?.longitude ?? null
  activityOpen.value = true
  await nextTick()
  const host = activityPlaceHost.value
  if (!host) return
  host.replaceChildren()
  try {
    await loadGoogleMaps()
    const { PlaceAutocompleteElement } = await getPlacesLibrary()
    const autocomplete = new PlaceAutocompleteElement({
      locationRestriction: { west: tripCenter.lng - 0.65, east: tripCenter.lng + 0.65, south: tripCenter.lat - 0.45, north: tripCenter.lat + 0.45 },
    })
    autocomplete.placeholder = 'Treffpunkt auf Google Maps suchen …'
    autocomplete.addEventListener('gmp-select', async event => {
      try {
        const prediction = event.placePrediction
        if (!prediction) return
        const place = prediction.toPlace()
        await place.fetchFields({ fields: ['id', 'displayName', 'formattedAddress', 'location'] })
        activityMeetingFromGoogle = place.displayName || place.formattedAddress || ''
        activityMeeting.value = activityMeetingFromGoogle
        activityAddress.value = place.formattedAddress || ''
        activityGooglePlaceId.value = place.id || null
        activityLatitude.value = place.location ? place.location.lat() : null
        activityLongitude.value = place.location ? place.location.lng() : null
        activityPlaceError.value = ''
      } catch (cause) {
        activityPlaceError.value = cause instanceof Error ? cause.message : 'Treffpunkt konnte nicht geladen werden.'
      }
    })
    host.appendChild(autocomplete)
  } catch (cause) {
    activityPlaceError.value = cause instanceof Error ? cause.message : 'Google-Suche nicht verfügbar. Treffpunkt manuell eingeben.'
  }
}
watch(activityMeeting, value => {
  if (activityGooglePlaceId.value && value !== activityMeetingFromGoogle) {
    activityGooglePlaceId.value = null
    activityLatitude.value = null
    activityLongitude.value = null
    activityAddress.value = ''
  }
})
let activityMeetingFromGoogle = ''
async function loadActivities() {
  const trip = trips.currentTrip
  if (!trip) return
  const { data, error } = await supabase.from('trip_activities').select('*').eq('trip_id', trip.id).order('planned_order')
  if (error) throw error
  activities.value = (data || []) as Activity[]
  await refreshActivityMarkers()
}
async function createActivity() {
  const trip = trips.currentTrip
  if (!trip || activitySaving.value) return
  activitySaving.value = true
  activityError.value = ''
  try {
    const day = tripDays.value.find(d => d.id === activityDayId.value)
    if (!day || !activityName.value.trim() || !activityStart.value || !activityMeeting.value.trim()) throw new Error('Name, Tag, Beginn und Treffpunkt sind erforderlich.')
    const order = Math.max(0, ...places.value.filter(p => p.planned_day === day.day_date).map(p => p.planned_order || 0), ...activities.value.filter(a => a.trip_day_id === day.id).map(a => a.planned_order || 0)) + 1
    const payload = { trip_id: trip.id, trip_day_id: day.id, name: activityName.value.trim(), start_time: activityStart.value, meeting_place_name: activityMeeting.value.trim(), address: activityAddress.value || null, google_place_id: activityGooglePlaceId.value, latitude: activityLatitude.value, longitude: activityLongitude.value, planned_order: editingActivityId.value ? activities.value.find(a => a.id === editingActivityId.value)?.planned_order || order : order, status: 'planned' }
    const request = editingActivityId.value ? supabase.from('trip_activities').update(payload).eq('id',editingActivityId.value).eq('trip_id',trip.id) : supabase.from('trip_activities').insert(payload)
    const { error } = await request
    if (error) throw error
    await loadActivities()
    activityOpen.value = false
    activityName.value = ''
    activityStart.value = ''
    activityMeeting.value = ''
  } catch (e) { activityError.value = e instanceof Error ? e.message : 'Aktivität konnte nicht gespeichert werden.' }
  finally { activitySaving.value = false }
}
const loading = ref(true)
const error = ref('')
const mapHost = ref<HTMLElement | null>(null)
const selectedCategory = ref('all')
const selectedDay = ref('unplanned')
const dayPlanSaving = ref(false)
const dayPlanError = ref('')
const selectedDayRecord = computed(() => tripDays.value.find(day => day.day_date === selectedDay.value))
type DayStop = { id: string; name: string; start_time: string | null; end_time: string | null; planned_order: number | null; kind: 'place' | 'activity'; place?: TripPlace; activity?: Activity }
const dayStops = computed<DayStop[]>(() => {
  const ps: DayStop[] = places.value.filter(p => p.category !== 'hotel' && p.planned_day === selectedDay.value).map(p => ({ id: 'place:' + p.id, name: p.name, start_time: p.start_time, end_time: p.end_time, planned_order: p.planned_order, kind: 'place', place: p }))
  const as: DayStop[] = activities.value.filter(a => a.trip_day_id === selectedDayRecord.value?.id).map(a => ({ id: 'activity:' + a.id, name: a.name, start_time: a.start_time, end_time: a.end_time, planned_order: a.planned_order, kind: 'activity', activity: a }))
  return [...ps,...as].sort((a,b) => (a.planned_order || 999999) - (b.planned_order || 999999) || a.name.localeCompare(b.name,'de'))
})
const todayCompletedCount = computed(() => dayStops.value.filter(stop => stop.place?.visited).length)
const todayNextStop = computed(() => dayStops.value.find(stop => !stop.place?.visited) || null)
const todayIsTripDay = computed(() => tripDays.value.some(day => day.day_date === selectedDay.value))
function focusTodayStop(stop: DayStop) {
  if (stop.activity) void focusActivity(stop.activity)
  else if (stop.place) focusDayPlace(stop.place)
  mobilePlacesOpen.value = false
}

// Planned routes keep the day-stop order. Transit uses one Google Routes request per leg.
type RoutePoint = { lat: number; lng: number }
type RoutesPolyline = { setMap: (map: MapInstance | null) => void }
type TransitDetails = { transitLine?: { shortName?: string; name?: string; vehicle?: { type?: string } }; headsign?: string; departureStop?: { name?: string }; arrivalStop?: { name?: string }; departureTime?: Date | string; arrivalTime?: Date | string; stopCount?: number }
type TransitStep = { transitDetails?: TransitDetails }
type TransitLeg = { steps?: TransitStep[] }
type TransitConnection = { section: number; fromStop: string; toStop: string; line: string; icon: string; headsign: string; from: string; to: string; departure: string; arrival: string; stops: number }
type ComputedRoute = { legs?: TransitLeg[]; path?: RoutePoint[]; distanceMeters?: number; durationMillis?: number; createPolylines: (options: { polylineOptions: Record<string, unknown> }) => RoutesPolyline[] }
type RoutesClass = { computeRoutes: (request: Record<string, unknown>) => Promise<{ routes?: ComputedRoute[] }> }
const routeStart = ref<'location' | 'first' | 'hotel'>('first')
const routeEnd = ref<'location' | 'hotel' | 'last'>('last')
const routeMode = ref<'walking' | 'transit' | 'auto'>('walking')
const routeVisible = ref(false)
const routeBusy = ref(false)
const transitRefreshBusy = ref(false)
const transitLastUpdated = ref<Date | null>(null)
const transitRefreshNotice = ref('')
const transitChangeWarnings = ref<Record<number, string>>({})
const routeError = ref('')
const routeSummary = ref('')
const transitConnections = ref<TransitConnection[]>([])
type RouteLegMetric = { distanceMeters: number; durationMillis: number; mode: 'walking' | 'transit' }
const transitMetrics = ref<RouteLegMetric[]>([])
function legDistance(meters: number): string { return meters < 1000 ? Math.round(meters) + ' m' : (meters / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' km' }
function legDuration(millis: number): string { return 'ca. ' + Math.round(millis / 60000) + ' Min.' }
const transitLegs = computed(() => {
  const groups = new Map<number, TransitConnection[]>()
  for (const connection of transitConnections.value) {
    const existing = groups.get(connection.section) || []
    existing.push(connection)
    groups.set(connection.section, existing)
  }
  return groups
})
const routeAgendaStops = computed(() => {
  const stops: { key: string; name: string; stop?: DayStop }[] = dayStops.value.map(stop => ({ key: stop.id, name: stop.name, stop }))
  if (routeStart.value === 'location') stops.unshift({ key: 'start-location', name: 'Aktueller Standort' })
  if (routeStart.value === 'hotel') stops.unshift({ key: 'start-hotel', name: dayHotel('start')?.name || 'Unterkunft' })
  if (routeEnd.value === 'location') stops.push({ key: 'end-location', name: 'Aktueller Ort' })
  if (routeEnd.value === 'hotel') stops.push({ key: 'end-hotel', name: dayHotel('end')?.name || 'Unterkunft' })
  return stops
})

function plannedTransitTime(clock: string | null | undefined): Date | null {
  if (!clock || !/^\d{1,2}:\d{2}/.test(clock) || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDay.value)) return null
  const [year, month, day] = selectedDay.value.split('-').map(Number)
  const [hour, minute] = clock.split(':').map(Number)
  if (!year || !month || !day || hour == null || minute == null || hour > 23 || minute > 59) return null
  const value = new Date(year, month - 1, day, hour, minute)
  const delta = value.getTime() - Date.now()
  return delta >= -7 * 86400000 && delta <= 100 * 86400000 ? value : null
}
function transitClock(value?: Date | string): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(date)
}
function transitIcon(type?: string): string {
  const value = (type || '').toUpperCase()
  if (value.includes('BUS')) return '🚌'
  if (value.includes('TRAM') || value.includes('LIGHT_RAIL')) return '🚊'
  if (value.includes('TRAIN') || value.includes('RAIL')) return '🚆'
  return '🚇'
}

let routePolylines: RoutesPolyline[] = []
let routeRequestId = 0
let cachedRoute: { key: string; segments: ComputedRoute[]; metrics: RouteLegMetric[]; connections: TransitConnection[]; summary: string } | null = null
function routeCacheKey(): string { return JSON.stringify({ trip: trips.currentTrip?.id, day: selectedDay.value, start: routeStart.value, end: routeEnd.value, mode: routeMode.value, stops: dayStops.value.map(stop => [stop.id, stop.planned_order, stop.start_time, stop.end_time, stopCoordinates(stop)]), hotelStart: dayHotel('start')?.id, hotelEnd: dayHotel('end')?.id, location: routeStart.value === 'location' || routeEnd.value === 'location' ? userLocation.value : null }) }
function hideRouteDisplay() { routeRequestId++; routeVisible.value = false; routeBusy.value = false; clearRoutePolylines() }
function clearRouteCache() { cachedRoute = null; transitMetrics.value = []; transitConnections.value = []; routeSummary.value = ''; transitLastUpdated.value = null; transitChangeWarnings.value = {}; transitRefreshNotice.value = '' }
function getCachedRoute() { return cachedRoute }
function transitSignature(connections: TransitConnection[], section: number): string { return JSON.stringify(connections.filter(connection => connection.section === section).map(connection => [connection.line, connection.headsign, connection.from, connection.to, connection.departure, connection.arrival])) }
function transitMapsUrl(index: number): string {
  const from = routeAgendaStops.value[index]?.stop
  const to = routeAgendaStops.value[index + 1]?.stop
  const point = (entry: typeof from, fallback: string) => { const coords = entry ? stopCoordinates(entry) : null; return coords ? coords.lat + ',' + coords.lng : fallback }
  const origin = point(from, routeAgendaStops.value[index]?.name || '')
  const destination = point(to, routeAgendaStops.value[index + 1]?.name || '')
  return 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(destination) + '&travelmode=transit'
}
async function refreshTransitConnections() {
  if (transitRefreshBusy.value || routeBusy.value || !cachedRoute || routeMode.value === 'walking') return
  const snapshot = cachedRoute
  transitRefreshBusy.value = true
  transitRefreshNotice.value = ''
  // Preserve the last valid connections if the fresh request fails.
  cachedRoute = null
  routeVisible.value = true
  try {
    await showWalkingRoute()
    if (routeError.value || !cachedRoute) {
      cachedRoute = snapshot
      transitConnections.value = snapshot.connections
      transitMetrics.value = snapshot.metrics
      routeSummary.value = snapshot.summary
      transitRefreshNotice.value = 'Aktualisierung fehlgeschlagen. Die bisherigen Verbindungen werden weiterhin angezeigt.'
      routeError.value = ''
      renderRoute(snapshot.segments, snapshot.metrics, snapshot.connections, snapshot.summary)
      return
    }
    const refreshed = getCachedRoute()
    if (!refreshed) return
    const warnings: Record<number, string> = {}
    for (const metric of refreshed.metrics.entries()) {
      const [index, leg] = metric
      if (leg.mode !== 'transit') continue
      const previous = transitSignature(snapshot.connections, index + 1)
      const current = transitSignature(refreshed.connections, index + 1)
      if (previous && current && previous !== current) warnings[index + 1] = '⚠️ Die Verbindung hat sich seit der letzten Abfrage geändert. Bitte Linie und Abfahrtszeit prüfen.'
    }
    transitChangeWarnings.value = warnings
    transitLastUpdated.value = new Date()
    transitRefreshNotice.value = Object.keys(warnings).length ? 'Verbindungen aktualisiert – Änderungen erkannt.' : 'Verbindungen aktualisiert – keine Änderungen erkannt.'
  } finally { transitRefreshBusy.value = false }
}
function renderRoute(segments: ComputedRoute[], metrics: RouteLegMetric[], connections: TransitConnection[], summary: string) {
  if (!map || !routeVisible.value) return
  clearRoutePolylines()
  transitMetrics.value = metrics
  transitConnections.value = connections
  routeSummary.value = summary
  const bounds = new (getGoogleMaps().LatLngBounds)()
  for (const [index, segment] of segments.entries()) {
    const lines = segment.createPolylines({ polylineOptions: { strokeColor: metrics[index]?.mode === 'transit' ? '#2563eb' : '#2f625d', strokeOpacity: 0.95, strokeWeight: 6, zIndex: 10 } })
    for (const line of lines) { line.setMap(map); routePolylines.push(line) }
    for (const point of segment.path || []) bounds.extend(point)
  }
  if (segments.some(segment => segment.path?.length)) map.fitBounds(bounds, 70)
}
function clearRoutePolylines() {
  for (const line of routePolylines) line.setMap(null)
  routePolylines = []
}
function stopCoordinates(stop: DayStop): RoutePoint | null {
  const lat = stop.place?.latitude ?? stop.activity?.latitude
  const lng = stop.place?.longitude ?? stop.activity?.longitude
  return lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) ? null : { lat: Number(lat), lng: Number(lng) }
}
function dayHotel(role: 'start' | 'end' = 'start'): TripPlace | undefined {
  const hotels = places.value.filter(p => p.category === 'hotel' && p.stay_from && p.stay_until && p.stay_from <= selectedDay.value && p.stay_until >= selectedDay.value && p.latitude != null && p.longitude != null).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  if (hotels.length < 2) return hotels[0]
  return role === 'end' ? hotels.find(h => h.stay_from === selectedDay.value) || hotels[hotels.length - 1] : hotels.find(h => h.stay_until === selectedDay.value) || hotels[0]
}
function hideWalkingRoute() {
  routeRequestId++
  routeVisible.value = false
  routeBusy.value = false
  routeError.value = ''
  clearRouteCache()
  clearRoutePolylines()
}
async function showWalkingRoute() {
  if (!map) return
  const requestId = ++routeRequestId
  routeBusy.value = true
  routeError.value = ''
  transitRefreshNotice.value = ''
  routeSummary.value = ''
  transitConnections.value = []
  transitMetrics.value = []
  clearRoutePolylines()
  const key = routeCacheKey()
  if (cachedRoute?.key === key) {
    renderRoute(cachedRoute.segments, cachedRoute.metrics, cachedRoute.connections, cachedRoute.summary)
    routeBusy.value = false
    return
  }
  const stops = dayStops.value.map(stopCoordinates)
  if (stops.some(p => !p)) {
    routeError.value = 'Mindestens ein Stopp hat keine Kartenkoordinaten.'
    routeBusy.value = false
    return
  }
  const points = stops as RoutePoint[]
  if (!points.length) { routeError.value = 'Für diesen Tag sind keine Stopps vorhanden.'; routeBusy.value = false; return }
  if (points.length > 24) { routeError.value = 'Maximal 24 Stopps können in einer Route berechnet werden.'; routeBusy.value = false; return }
  let origin: RoutePoint
  if (routeStart.value === 'location') {
    if (!userLocation.value) { routeError.value = 'Aktueller Standort nicht verfügbar. Bitte Standortfreigabe prüfen.'; routeBusy.value = false; return }
    origin = userLocation.value
  } else if (routeStart.value === 'hotel') {
    const hotel = dayHotel()
    if (!hotel) { routeError.value = 'Für diesen Tag ist keine Unterkunft mit Standort hinterlegt.'; routeBusy.value = false; return }
    origin = { lat: Number(hotel.latitude), lng: Number(hotel.longitude) }
  } else origin = points[0]!
  const destinations = routeStart.value === 'first' ? points.slice(1) : [...points]
  if (routeEnd.value === 'location') {
    if (!userLocation.value) { routeError.value = 'Aktueller Standort als Endpunkt nicht verfügbar.'; routeBusy.value = false; return }
    destinations.push(userLocation.value)
  } else if (routeEnd.value === 'hotel') {
    const hotel = dayHotel('end')
    if (!hotel) { routeError.value = 'Für diesen Tag ist keine Unterkunft als Endpunkt hinterlegt.'; routeBusy.value = false; return }
    destinations.push({ lat: Number(hotel.latitude), lng: Number(hotel.longitude) })
  }
  const stopNames = [routeStart.value === 'location' ? 'Aktueller Standort' : routeStart.value === 'hotel' ? 'Unterkunft' : dayStops.value[0]?.name || 'Erster Stopp', ...dayStops.value.slice(routeStart.value === 'first' ? 1 : 0).map(stop => stop.name)]
  if (routeEnd.value !== 'last') stopNames.push(routeEnd.value === 'hotel' ? 'Unterkunft' : 'Aktueller Standort')
  if (!destinations.length) { routeError.value = 'Für eine Route werden mindestens zwei unterschiedliche Punkte benötigt.'; routeBusy.value = false; return }
  try {
    await loadGoogleMaps()
    const routesLibrary = await getGoogleMaps().importLibrary('routes') as { Route?: RoutesClass }
    if (!routesLibrary.Route) throw new Error('Google Routes Library konnte nicht geladen werden.')
    const mode = routeMode.value
    const segments: ComputedRoute[] = []
    const metrics: RouteLegMetric[] = []
    const routePoints = [origin, ...destinations]
    for (let index = 0; index < routePoints.length - 1; index++) {
      if (requestId !== routeRequestId || !routeVisible.value) return
      const from = routePoints[index]!
      const to = routePoints[index + 1]!
      const compute = async (travelMode: 'WALKING' | 'TRANSIT'): Promise<ComputedRoute | null> => {
        const request: Record<string, unknown> = {
          origin: from, destination: to, travelMode,
          fields: travelMode === 'TRANSIT' ? ['path', 'distanceMeters', 'durationMillis', 'legs'] : ['path', 'distanceMeters', 'durationMillis'],
        }
        if (travelMode === 'TRANSIT') {
          request.transitPreference = { allowedTransitModes: ['BUS', 'SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL'], routingPreference: 'FEWER_TRANSFERS' }
          // As in v2: prefer arrival at the next planned stop, otherwise departure after the previous stop.
          const targetStop = dayStops.value[index + (routeStart.value === 'first' ? 1 : 0)]
          const sourceStop = dayStops.value[index - (routeStart.value === 'first' ? 0 : 1)]
          const arrival = plannedTransitTime(targetStop?.start_time || targetStop?.end_time)
          const departure = plannedTransitTime(sourceStop?.end_time || sourceStop?.start_time)
          if (arrival) request.arrivalTime = arrival
          else request.departureTime = departure || new Date()
        }
        const { routes } = await routesLibrary.Route!.computeRoutes(request)
        return routes?.[0] || null
      }
      let walking: ComputedRoute | null = null
      let transit: ComputedRoute | null = null
      if (mode !== 'transit') {
        try { walking = await compute('WALKING') } catch (cause) { if (mode === 'walking') throw cause }
      }
      if (mode !== 'walking') {
        try { transit = await compute('TRANSIT') } catch (cause) { if (mode === 'transit') throw cause }
      }
      const walkMinutes = walking?.durationMillis != null ? walking.durationMillis / 60000 : Infinity
      const transitMinutes = transit?.durationMillis != null ? transit.durationMillis / 60000 : Infinity
      const useTransit = mode === 'transit' || (mode === 'auto' && !!transit && (!walking || transitMinutes + 5 < walkMinutes))
      const chosen = useTransit ? transit : walking
      if (!chosen) throw new Error('Für Abschnitt ' + (index + 1) + ' wurde keine ' + (mode === 'walking' ? 'Fußroute' : mode === 'transit' ? 'ÖPNV-Verbindung' : 'Route') + ' gefunden.')
      segments.push(chosen)
      metrics.push({ distanceMeters: chosen.distanceMeters || 0, durationMillis: chosen.durationMillis || 0, mode: useTransit ? 'transit' : 'walking' })
    }
    if (requestId !== routeRequestId || !routeVisible.value || !map) return
    let connections: TransitConnection[] = []
    if (mode !== 'walking') {
      connections = segments.flatMap((segment, section) =>
        (segment.legs || []).flatMap(leg => (leg.steps || []).flatMap(step => {
          const details = step.transitDetails
          if (!details) return []
          const line = details.transitLine
          return [{
            section: section + 1,
            fromStop: stopNames[section] || 'Start',
            toStop: stopNames[section + 1] || 'Ziel',
            line: line?.shortName || line?.name || 'ÖPNV',
            icon: transitIcon(line?.vehicle?.type),
            headsign: details.headsign || '',
            from: details.departureStop?.name || '',
            to: details.arrivalStop?.name || '',
            departure: transitClock(details.departureTime),
            arrival: transitClock(details.arrivalTime),
            stops: details.stopCount || 0,
          }]
        }))
      )
    }
    const distance = segments.reduce((sum, segment) => sum + (segment.distanceMeters || 0), 0)
    const duration = segments.reduce((sum, segment) => sum + (segment.durationMillis || 0), 0)
    const summary = legDistance(distance) + ' · ' + legDuration(duration) + (mode === 'auto' ? ' · 🚶 ' + metrics.filter(item => item.mode === 'walking').length + ' · 🚇 ' + metrics.filter(item => item.mode === 'transit').length : '')
    cachedRoute = { key, segments, metrics, connections, summary }
    transitLastUpdated.value = new Date()
    renderRoute(segments, metrics, connections, summary)
  } catch (cause) {
    if (requestId === routeRequestId) {
      clearRoutePolylines()
      routeError.value = cause instanceof Error ? cause.message : 'Routenberechnung fehlgeschlagen.'
    }
  } finally {
    if (requestId === routeRequestId) routeBusy.value = false
  }
}
function toggleWalkingRoute() {
  mobilePlacesOpen.value = false
  if (routeVisible.value) hideWalkingRoute()
  else { routeVisible.value = true; void showWalkingRoute() }
}
watch([selectedDay, routeStart, routeEnd, routeMode, dayStops], () => {
  if (routeVisible.value) void showWalkingRoute()
})

const dayPlanList = ref<HTMLElement | null>(null)
const activityMarkers = new Map<string, AdvancedMarkerInstance>()
const activeActivity = ref<Activity | null>(null)
const activityPosition = ref<{ lat: number; lng: number } | null>(null)
function dayStopNumber(id: string) {
  const index = dayStops.value.findIndex(stop => stop.id === id)
  return index < 0 ? null : index + 1
}
async function focusActivity(activity: Activity) {
  cancelPendingPlaceFocus()
  closePlacePopup()
  activeActivity.value = activity
  let lat = activity.latitude
  let lng = activity.longitude
  if (lat == null || lng == null) {
    try {
      const position = await geocodeDestination(activity.address || activity.meeting_place_name || '')
      lat = position.lat
      lng = position.lng
    } catch { /* no geocodable meeting point */ }
  }
  activityPosition.value = lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null
  if (activityPosition.value && map) {
    map.panTo(activityPosition.value)
    map.setZoom(Math.max(map.getZoom() || 0, 16))
  }
}
async function refreshActivityMarkers() {
  for (const marker of activityMarkers.values()) marker.map = null
  activityMarkers.clear()
  if (!map) return
  const { AdvancedMarkerElement } = await getMarkerLibrary()
  for (const activity of activities.value) {
    // Activities belong to a specific day; never show markers from other days.
    if (activeTab.value === 'places' || !selectedDayRecord.value || activity.trip_day_id !== selectedDayRecord.value.id) continue
    if (activity.latitude == null || activity.longitude == null) continue
    const element = document.createElement('div')
    element.className = 'v3-activity-pin'
    const day = tripDays.value.find(item => item.id === activity.trip_day_id)
    const number = day?.day_date === selectedDay.value ? dayStopNumber('activity:' + activity.id) : null
    element.textContent = number ? String(number) : '🎟'
    const marker = new AdvancedMarkerElement({ map, position: { lat: Number(activity.latitude), lng: Number(activity.longitude) }, title: activity.name, content: element, gmpClickable: true, zIndex: number ? 500 + number : 80 })
    marker.addEventListener('gmp-click', () => { void focusActivity(activity) })
    activityMarkers.set(activity.id, marker)
  }
}
const dragOrder = ref<string[] | null>(null)
const renderedDayStops = computed(() => {
  if (!dragOrder.value) return dayStops.value
  const byId = new Map(dayStops.value.map(stop => [stop.id, stop]))
  return dragOrder.value.map(id => byId.get(id)).filter((stop): stop is DayStop => !!stop)
})
type StopDrag = { pointerId: number; sourceId: string; startY: number; ghost: HTMLElement | null; handle: HTMLElement; original: string[] }
let stopDrag: StopDrag | null = null
function onStopPointerDown(event: PointerEvent, id: string) {
  if (dayPlanSaving.value || (event.button !== undefined && event.button !== 0)) return
  const handle = event.currentTarget as HTMLElement
  const row = handle.closest<HTMLElement>('.day-plan-stop')
  if (!row) return
  event.preventDefault()
  const rect = row.getBoundingClientRect()
  const ghost = row.cloneNode(true) as HTMLElement
  ghost.classList.add('day-plan-ghost')
  ghost.style.left = rect.left + 'px'
  ghost.style.top = rect.top + 'px'
  ghost.style.width = rect.width + 'px'
  ghost.style.height = rect.height + 'px'
  // The floating clone lives outside the scoped Vue component. Preserve the
  // computed typography explicitly so it looks identical while dragging.
  const copyTypography = (source: Element, target: HTMLElement) => {
    const style = window.getComputedStyle(source)
    target.style.fontFamily = style.fontFamily
    target.style.fontSize = style.fontSize
    target.style.fontWeight = style.fontWeight
    target.style.fontStyle = style.fontStyle
    target.style.lineHeight = style.lineHeight
    target.style.letterSpacing = style.letterSpacing
    target.style.color = style.color
  }
  copyTypography(row, ghost)
  const originalText = row.querySelector<HTMLElement>('.day-plan-stop__place')
  const ghostText = ghost.querySelector<HTMLElement>('.day-plan-stop__place')
  if (originalText && ghostText) {
    copyTypography(originalText, ghostText)
    const originalChildren = originalText.querySelectorAll<HTMLElement>('span, small, strong')
    const ghostChildren = ghostText.querySelectorAll<HTMLElement>('span, small, strong')
    originalChildren.forEach((child, index) => {
      if (ghostChildren[index]) copyTypography(child, ghostChildren[index])
    })
  }
  document.body.appendChild(ghost)
  row.classList.add('day-plan-stop--dragging')
  const original = dayStops.value.map(stop => stop.id)
  dragOrder.value = [...original]
  stopDrag = { pointerId: event.pointerId, sourceId: id, startY: event.clientY, ghost, handle, original }
  handle.setPointerCapture(event.pointerId)
}
async function onStopPointerMove(event: PointerEvent) {
  const drag = stopDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  event.preventDefault()
  if (drag.ghost) drag.ghost.style.transform = 'translateY(' + (event.clientY - drag.startY) + 'px)'
  const rows = [...(dayPlanList.value?.querySelectorAll<HTMLElement>('.day-plan-stop') || [])]
  const ordered = dragOrder.value
  if (!ordered) return
  const candidates = rows.filter(row => row.dataset.dayStopId !== drag.sourceId)
  let targetIndex = candidates.findIndex(row => event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2)
  if (targetIndex < 0) targetIndex = candidates.length
  const next = ordered.filter(id => id !== drag.sourceId)
  next.splice(targetIndex, 0, drag.sourceId)
  if (next.some((id, index) => id !== ordered[index])) {
    const before = new Map(rows.map(row => [row.dataset.dayStopId, row.getBoundingClientRect().top]))
    dragOrder.value = next
    await nextTick()
    dayPlanList.value?.querySelectorAll<HTMLElement>('.day-plan-stop').forEach(row => {
      if (row.dataset.dayStopId === drag.sourceId) return
      const previous = before.get(row.dataset.dayStopId)
      if (previous == null) return
      const delta = previous - row.getBoundingClientRect().top
      if (Math.abs(delta) > 1) row.animate([{ transform: 'translateY(' + delta + 'px)' }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' })
    })
  }
}
async function onStopPointerEnd(event: PointerEvent, cancelled = false) {
  const drag = stopDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  stopDrag = null
  try { drag.handle.releasePointerCapture(drag.pointerId) } catch { /* capture may already be released */ }
  drag.ghost?.classList.add('day-plan-ghost--out')
  if (drag.ghost) { const ghost = drag.ghost; window.setTimeout(() => ghost.remove(), 120) }
  const newOrder = dragOrder.value
  dragOrder.value = null
  if (cancelled || !newOrder || newOrder.every((id, i) => id === drag.original[i])) return
  const trip = trips.currentTrip
  const day = selectedDayRecord.value
  if (!trip || !day) return
  dayPlanSaving.value = true
  dayPlanError.value = ''
  try {
    for (let i = 0; i < newOrder.length; i++) {
      const key = newOrder[i]
      if (key.startsWith('activity:')) {
        const activity = activities.value.find(a => a.id === key.slice(9))
        if (!activity || activity.planned_order === i + 1) continue
        const { error } = await supabase.from('trip_activities').update({ planned_order: i + 1 }).eq('id',activity.id).eq('trip_id',trip.id)
        if (error) throw error
        activity.planned_order = i + 1
      } else {
        const stop = places.value.find(p => p.id === key.slice(6))
        if (!stop || stop.planned_order === i + 1) continue
        await updateTripPlacePlanning(trip.id, stop, day.id, i + 1, stop.start_time, stop.end_time)
        stop.planned_order = i + 1
      }
    }
    refreshMarkerAppearances()
    await refreshActivityMarkers()
  } catch (cause) {
    dayPlanError.value = cause instanceof Error ? cause.message : 'Reihenfolge konnte nicht gespeichert werden.'
    places.value = await listTripPlaces(trip.id)
    await loadActivities()
  } finally { dayPlanSaving.value = false }
}
const searchQuery = ref('')
const mobilePlacesOpen = ref(false)
type WorkspaceTab = 'plan' | 'places' | 'today' | 'tools'
const activeTab = ref<WorkspaceTab>('plan')
let lastPlanDay = 'unplanned'
let lastTodayDay: string | null = null
function firstTripDay() {
  return [...tripDays.value].sort((a, b) => a.day_date.localeCompare(b.day_date))[0]?.day_date || 'unplanned'
}
const orderedTripDays = computed(() => [...tripDays.value].sort((a, b) => a.day_date.localeCompare(b.day_date)))
const todayDayIndex = computed(() => orderedTripDays.value.findIndex(day => day.day_date === selectedDay.value))
function moveTodayDay(direction: -1 | 1) {
  if (activeTab.value !== 'today') return
  const next = orderedTripDays.value[todayDayIndex.value + direction]
  if (next) selectedDay.value = next.day_date
}
function openWorkspaceTab(tab: WorkspaceTab) {
  if (activeTab.value === tab && mobilePlacesOpen.value) { mobilePlacesOpen.value = false; return }
  if (activeTab.value === 'today' && tab !== 'today') hideRouteDisplay()
  if (activeTab.value === 'plan') lastPlanDay = selectedDay.value
  if (activeTab.value === 'today' && tripDays.value.some(day => day.day_date === selectedDay.value)) lastTodayDay = selectedDay.value
  activeTab.value = tab
  mobilePlacesOpen.value = true
  if (tab === 'today') {
    selectedDay.value = lastTodayDay && tripDays.value.some(day => day.day_date === lastTodayDay) ? lastTodayDay : firstTripDay()
  } else if (tab === 'plan') selectedDay.value = lastPlanDay
}

const selectedPlaceId = ref<string | null>(null)
const placePopup = ref<HTMLElement | null>(null)
const activePlace = ref<TripPlace | null>(null)
const editingPlace = ref(false)
const editOriginalAddress = ref('')
const popupDay = ref('')
const popupStart = ref('')
const popupEnd = ref('')
const userLocation = ref<{ lat: number; lng: number } | null>(null)
const navigationState = ref<'idle' | 'active' | 'paused'>('idle')
const navigationTargetIndex = ref(0)
const navigationAccuracy = ref<number | null>(null)
const navigationMessage = ref('')
let navigationWatchId: number | null = null
let navigationRouteRequest = 0
let navigationLastRouteAt = 0
let navigationLastRouteOrigin: RoutePoint | null = null
let navigationLines: RoutesPolyline[] = []
const navigationDistance = ref<number | null>(null)
const navigationDuration = ref<number | null>(null)
const navigationRouting = ref(false)
const navigationMapMode = ref<'follow' | 'overview'>('follow')
let navigationRouteBounds: { fit: () => void } | null = null
function showNavigationMapMode(mode: 'follow' | 'overview') {
  navigationMapMode.value = mode
  if (!map) return
  if (mode === 'overview') navigationRouteBounds?.fit()
  else if (userLocation.value) { (map as ClusterMap).setCenter(userLocation.value); (map as unknown as { setZoom: (zoom: number) => void }).setZoom(16) }
}
const navigationArrived = ref(false)
let navigationArrivalSamples = 0
function checkNavigationArrivalV3(position: RoutePoint, accuracy: number) {
  const destination = navigationTarget.value ? stopCoordinates(navigationTarget.value) : null
  if (!destination || navigationArrived.value || accuracy > 60) { navigationArrivalSamples = 0; return }
  if (distanceBetween(position, destination) <= Math.max(30, Math.min(60, accuracy))) {
    navigationArrivalSamples++
    if (navigationArrivalSamples >= 2) {
      navigationArrived.value = true
      navigationArrivalSamples = 0
      navigationMessage.value = 'Ziel erreicht: ' + navigationTarget.value?.name
    }
  } else navigationArrivalSamples = 0
}
function confirmNavigationArrivalV3() {
  if (navigationTargetIndex.value >= dayStops.value.length - 1) stopDayNavigationV3()
  else nextNavigationStopV3()
}
function distanceBetween(a: RoutePoint, b: RoutePoint): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v))
}
function clearNavigationRouteV3() {
  navigationRouteRequest++
  navigationLines.forEach(line => line.setMap(null))
  navigationLines = []
  navigationRouteBounds = null
  navigationDistance.value = null
  navigationDuration.value = null
  navigationRouting.value = false
}
async function updateNavigationRouteV3(force = false) {
  if (navigationState.value !== 'active' || !userLocation.value || !navigationTarget.value || !map) return
  const origin = { ...userLocation.value }
  const destination = stopCoordinates(navigationTarget.value)
  if (!destination) { navigationMessage.value = 'Für diesen Stopp fehlen die Kartenkoordinaten.'; return }
  if (!force && navigationLastRouteOrigin && Date.now() - navigationLastRouteAt < 45000 && distanceBetween(origin, navigationLastRouteOrigin) < 80) return
  const requestId = ++navigationRouteRequest
  navigationLastRouteAt = Date.now()
  navigationLastRouteOrigin = origin
  navigationRouting.value = true
  try {
    await loadGoogleMaps()
    const library = await getGoogleMaps().importLibrary('routes') as { Route?: RoutesClass }
    if (!library.Route) throw new Error('Google Routes Library nicht verfügbar.')
    const mode = routeMode.value === 'transit' ? 'TRANSIT' : 'WALKING'
    const request: Record<string, unknown> = { origin, destination, travelMode: mode, fields: ['path', 'distanceMeters', 'durationMillis'] }
    if (mode === 'TRANSIT') request.departureTime = new Date()
    const result = await library.Route.computeRoutes(request)
    if (requestId !== navigationRouteRequest || navigationState.value !== 'active' || !map) return
    const route = result.routes?.[0]
    if (!route) throw new Error('Keine Verbindung zum nächsten Stopp gefunden.')
    navigationLines.forEach(line => line.setMap(null))
    navigationLines = route.createPolylines({ polylineOptions: { strokeColor: '#e07b26', strokeWeight: 7, strokeOpacity: 0.95, zIndex: 30 } })
    navigationLines.forEach(line => line.setMap(map))
    navigationDistance.value = route.distanceMeters ?? 0
    navigationDuration.value = route.durationMillis ?? 0
    const bounds = new (getGoogleMaps().LatLngBounds)()
    bounds.extend(origin)
    bounds.extend(destination)
    for (const point of route.path || []) bounds.extend(point)
    navigationRouteBounds = { fit: () => map?.fitBounds(bounds, 65) }
    showNavigationMapMode(navigationMapMode.value)
    navigationMessage.value = ''
  } catch (cause) {
    if (requestId === navigationRouteRequest) navigationMessage.value = cause instanceof Error ? cause.message : 'Navigationsroute konnte nicht berechnet werden.'
  } finally {
    if (requestId === navigationRouteRequest) navigationRouting.value = false
  }
}

const navigationTarget = computed(() => dayStops.value[navigationTargetIndex.value] || null)
function stopNavigationTracking() {
  if (navigationWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(navigationWatchId)
  navigationWatchId = null
}
function startNavigationTracking() {
  if (!navigator.geolocation) { navigationMessage.value = 'GPS ist auf diesem Gerät nicht verfügbar.'; return false }
  stopNavigationTracking()
  navigationWatchId = navigator.geolocation.watchPosition(
    ({ coords }) => {
      userLocation.value = { lat: coords.latitude, lng: coords.longitude }
      navigationAccuracy.value = Math.round(coords.accuracy)
      if (!navigationArrived.value) navigationMessage.value = ''
      if (navigationState.value === 'active') {
        if (map && navigationMapMode.value === 'follow') (map as ClusterMap).setCenter(userLocation.value)
        checkNavigationArrivalV3(userLocation.value, coords.accuracy)
        if (!navigationArrived.value) void updateNavigationRouteV3()
      }
    },
    error => { navigationMessage.value = 'Standort konnte nicht aktualisiert werden: ' + error.message },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
  )
  return true
}
function startDayNavigationV3() {
  if (!dayStops.value.length) { navigationMessage.value = 'Für diesen Tag sind keine Stopps geplant.'; return }
  navigationTargetIndex.value = Math.max(0, dayStops.value.findIndex(stop => !stop.place?.visited))
  navigationArrived.value = false
  navigationArrivalSamples = 0
  if (!startNavigationTracking()) return
  navigationState.value = 'active'
  navigationMapMode.value = 'follow'
  mobilePlacesOpen.value = false
  navigationLastRouteAt = 0
  if (userLocation.value) void updateNavigationRouteV3(true)
}
function pauseDayNavigationV3() {
  stopNavigationTracking()
  navigationState.value = 'paused'
  clearNavigationRouteV3()
}
function resumeDayNavigationV3() {
  if (startNavigationTracking()) { navigationState.value = 'active'; navigationLastRouteAt = 0; if (userLocation.value) void updateNavigationRouteV3(true) }
}
function stopDayNavigationV3() {
  stopNavigationTracking()
  navigationState.value = 'idle'
  mobilePlacesOpen.value = false
  clearNavigationRouteV3()
  navigationAccuracy.value = null
  navigationArrived.value = false
  navigationArrivalSamples = 0
  navigationMessage.value = ''
}
function nextNavigationStopV3() {
  if (navigationTargetIndex.value < dayStops.value.length - 1) { navigationTargetIndex.value++; navigationArrived.value = false; navigationArrivalSamples = 0; navigationMessage.value = ''; navigationLastRouteAt = 0; clearNavigationRouteV3(); if (navigationState.value === 'active') void updateNavigationRouteV3(true) }
}
watch(selectedDay, () => { if (navigationState.value !== 'idle') stopDayNavigationV3() })

const addPlaceOpen = ref(false)
const addPlaceHost = ref<HTMLElement | null>(null)
const addPlaceName = ref('')
const addPlaceAddress = ref('')
const addPlaceCategory = ref('other')
const addPlaceNote = ref('')
const addPlaceLocalTip = ref(false)
const addPlaceDay = ref('')
const addPlaceStayFrom = ref('')
const addPlaceStayUntil = ref('')
const addPlaceSaving = ref(false)
const addPlaceMessage = ref('')
const addPlaceDuplicateId = ref<string | null>(null)
const sortByDistance = ref(false)
// Build refresh 2026-10-07: no functional change; triggers a fresh preview deployment.
let selectedGooglePlace: import('../services/google/maps').GooglePlaceDetails | null = null
let tripCenter = { lat: 50.1109, lng: 8.6821 }
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
    const dayMatches = activeTab.value === 'places' || (selectedDay.value === 'unplanned' ? !place.planned_day : place.planned_day === selectedDay.value || (place.category === 'hotel' && !!place.stay_from && !!place.stay_until && place.stay_from <= selectedDay.value && place.stay_until >= selectedDay.value))
    return categoryMatches && searchMatches && dayMatches
  }).sort((a, b) => {
    if (!sortByDistance.value || !userLocation.value) return a.name.localeCompare(b.name, 'de')
    return distanceFromUser(a) - distanceFromUser(b)
  })
})
const placeCategories = ['food','cafe','bar','sight','culture','leisure','thermal','viewpoint','transport','area','hotel','other']
const categories = computed(() => [...new Set(places.value.map(place => place.category || 'other'))].sort())

const activePlaceDistance = computed(() => {
  const place = activePlace.value
  const origin = userLocation.value
  if (!place || !origin || place.latitude == null || place.longitude == null) return null
  const toRad = (value: number) => value * Math.PI / 180
  const lat1 = toRad(origin.lat); const lat2 = toRad(Number(place.latitude))
  const dLat = lat2 - lat1; const dLng = toRad(Number(place.longitude) - origin.lng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
})

function distanceFromUser(place: TripPlace) {
  const origin = userLocation.value
  if (!origin || place.latitude == null || place.longitude == null) return Number.POSITIVE_INFINITY
  const toRad = (value: number) => value * Math.PI / 180
  const lat1 = toRad(origin.lat), lat2 = toRad(Number(place.latitude))
  const dLat = lat2 - lat1, dLng = toRad(Number(place.longitude) - origin.lng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function distanceLabel(distance: number) {
  return distance < 1 ? Math.round(distance * 1000) + ' m Luftlinie entfernt' : distance.toFixed(distance < 10 ? 1 : 0).replace('.', ',') + ' km Luftlinie entfernt'
}

function requestUserLocation() {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => { userLocation.value = { lat: coords.latitude, lng: coords.longitude } },
    () => { userLocation.value = null },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  )
}


function googlePlaceCategory(place: import('../services/google/maps').GooglePlaceDetails) {
  const types = new Set([...(place.types || []), place.primaryType].filter(Boolean))
  const has = (...values: string[]) => values.some(value => types.has(value))
  if (has('lodging','hotel','motel','hostel','bed_and_breakfast','guest_house','resort_hotel')) return 'hotel'
  if (has('cafe','coffee_shop','bakery')) return 'cafe'
  if (has('bar','night_club')) return 'bar'
  if (has('restaurant','meal_takeaway','meal_delivery','food')) return 'food'
  if (has('museum','art_gallery','performing_arts_theater','movie_theater')) return 'culture'
  if (has('tourist_attraction','historical_landmark','monument','church','place_of_worship')) return 'sight'
  if (has('park','amusement_park','zoo','aquarium','stadium')) return 'leisure'
  if (has('spa')) return 'thermal'
  if (has('transit_station','train_station','subway_station','bus_station','airport')) return 'transport'
  if (has('neighborhood','locality','sublocality')) return 'area'
  return 'other'
}

async function openAddPlace() {
  addPlaceOpen.value = true
  addPlaceMessage.value = ''
  addPlaceDuplicateId.value = null
  selectedGooglePlace = null
  addPlaceName.value = ''; addPlaceAddress.value = ''; addPlaceCategory.value = 'other'
  addPlaceNote.value = ''; addPlaceLocalTip.value = false; addPlaceDay.value = ''
  addPlaceStayFrom.value = trips.currentTrip?.start_date || ''; addPlaceStayUntil.value = trips.currentTrip?.end_date || ''
  await nextTick()
  if (!addPlaceHost.value) return
  addPlaceHost.value.innerHTML = ''
  try {
    const { PlaceAutocompleteElement } = await getPlacesLibrary()
    const autocomplete = new PlaceAutocompleteElement({
      locationBias: { center: { lat: tripCenter.lat, lng: tripCenter.lng }, radius: 50000 },
    })
    autocomplete.placeholder = 'Restaurant, Café, Sehenswürdigkeit …'
    autocomplete.addEventListener('gmp-select', async event => {
      const prediction = event.placePrediction
      if (!prediction) return
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ['id','displayName','formattedAddress','location','websiteURI','nationalPhoneNumber','regularOpeningHours','types','primaryType'] })
      selectedGooglePlace = place
      addPlaceName.value = place.displayName || ''
      addPlaceAddress.value = place.formattedAddress || ''
      addPlaceCategory.value = googlePlaceCategory(place)
      const duplicate = places.value.find(item =>
        (place.id && item.google_place_id === place.id) ||
        (item.name.trim().toLocaleLowerCase('de') === (place.displayName || '').trim().toLocaleLowerCase('de') &&
         (item.address || '').trim().toLocaleLowerCase('de') === (place.formattedAddress || '').trim().toLocaleLowerCase('de'))
      )
      addPlaceDuplicateId.value = duplicate?.id || null
      addPlaceMessage.value = duplicate
        ? '⚠️ Dieser Ort ist bereits in dieser Reise vorhanden.'
        : 'Google-Ort ausgewählt – Daten werden beim Speichern übernommen.'
    })
    addPlaceHost.value.appendChild(autocomplete)
  } catch (cause) {
    console.error('Google Places autocomplete could not be initialized', cause)
    addPlaceMessage.value = cause instanceof Error
      ? `Google-Ortssuche ist gerade nicht verfügbar: ${cause.message}`
      : 'Google-Ortssuche ist gerade nicht verfügbar. Der Ort kann manuell eingetragen werden.'
  }
}

async function saveNewPlace() {
  const trip = trips.currentTrip
  if (!trip || !addPlaceName.value.trim() || !addPlaceAddress.value.trim()) {
    addPlaceMessage.value = 'Bitte Name und Adresse eintragen.'
    return
  }
  if (addPlaceDuplicateId.value) {
    addPlaceMessage.value = '⚠️ Dieser Ort ist bereits in dieser Reise vorhanden und wird nicht erneut hinzugefügt.'
    return
  }
    if (addPlaceCategory.value === 'hotel' && (!addPlaceStayFrom.value || !addPlaceStayUntil.value || addPlaceStayUntil.value < addPlaceStayFrom.value)) {
    addPlaceMessage.value = 'Bitte einen gültigen Aufenthaltszeitraum für die Unterkunft eintragen.'
    return
  }
  addPlaceSaving.value = true
  try {
    let position = selectedGooglePlace?.location
      ? { lat: selectedGooglePlace.location.lat(), lng: selectedGooglePlace.location.lng() }
      : await geocodeDestination(addPlaceName.value + ', ' + addPlaceAddress.value)
    const day = addPlaceCategory.value === 'hotel' ? undefined : tripDays.value.find(item => item.day_date === addPlaceDay.value)
    const order = day ? Math.max(0, ...places.value.filter(item => item.planned_day === day.day_date).map(item => item.planned_order || 0)) + 1 : null
    const placeId = await addTripPlace(trip.id, {
      name: addPlaceName.value.trim(), address: addPlaceAddress.value.trim(),
      latitude: position.lat, longitude: position.lng, category: addPlaceCategory.value,
      note: addPlaceNote.value.trim() || null, googlePlaceId: selectedGooglePlace?.id || null,
      website: selectedGooglePlace?.websiteURI || null, phone: selectedGooglePlace?.nationalPhoneNumber || null,
      openingHours: selectedGooglePlace?.regularOpeningHours?.weekdayDescriptions?.join('\n') || null,
      isLocalTip: addPlaceLocalTip.value, dayId: day?.id || null, plannedOrder: order,
      stayFrom: addPlaceCategory.value === 'hotel' ? addPlaceStayFrom.value : null,
      stayUntil: addPlaceCategory.value === 'hotel' ? addPlaceStayUntil.value : null,
    })
    places.value = await listTripPlaces(trip.id)
    const added = places.value.find(item => item.id === placeId)
    addPlaceOpen.value = false
    if (added) {
      if (!markers.has(added.id) && added.latitude != null && added.longitude != null && map) {
        const { AdvancedMarkerElement } = await getMarkerLibrary()
        const marker = new AdvancedMarkerElement({
          map, position: { lat: Number(added.latitude), lng: Number(added.longitude) },
          title: added.name, content: markerContent(added), gmpClickable: true,
          zIndex: added.category === 'hotel' ? 900 : added.is_local_tip ? 100 : 1,
        })
        marker.addEventListener('gmp-click', () => openPlace(added))
        markers.set(added.id, marker)
      }
      syncMarkerVisibility()
      openPlace(added, true)
    }
  } catch (cause) {
    addPlaceMessage.value = cause instanceof Error ? cause.message : 'Ort konnte nicht gespeichert werden.'
  } finally { addPlaceSaving.value = false }
}

function centerOnCurrentLocation() {
  requestUserLocation()
  navigator.geolocation?.getCurrentPosition(({ coords }) => {
    const position = { lat: coords.latitude, lng: coords.longitude }
    userLocation.value = position
    map?.panTo(position); map?.setZoom(Math.max(map?.getZoom() || 0, 14))
  })
}

function fitAllPlaces() {
  if (!map) return
  const googleMaps = getGoogleMaps()
  const bounds = new googleMaps.LatLngBounds()
  let count = 0
  for (const place of visiblePlaces.value) {
    if (place.latitude == null || place.longitude == null) continue
    bounds.extend({ lat: Number(place.latitude), lng: Number(place.longitude) }); count++
  }
  if (count) map.fitBounds(bounds, 56)
}

function centerOnDestination() {
  map?.panTo(tripCenter); map?.setZoom(12)
}

function label(category: string) {
  return ({ food:'Essen', cafe:'Café', bar:'Bar', sight:'Sehenswürdigkeit', culture:'Kultur', leisure:'Freizeit', thermal:'Thermalbad', viewpoint:'Aussicht', transport:'Verkehr', area:'Gebiet', hotel:'Unterkunft', other:'Sonstiges' } as Record<string,string>)[category] || category
}

const openingClockTick = ref(0)
let openingClockTimer: ReturnType<typeof setInterval> | null = null
function statusForPlace(place: TripPlace) {
  void openingClockTick.value
  const planned = activeTab.value === 'plan' || activeTab.value === 'today'
  return openingStatus(place.opening_hours, trips.currentTrip?.destination,
    planned && place.planned_day === selectedDay.value ? place.planned_day : null,
    planned && place.planned_day === selectedDay.value ? place.start_time : null)
}
const markerColors: Record<string,string> = { food:'#f97316', cafe:'#a16207', bar:'#7c3aed', sight:'#2563eb', culture:'#db2777', leisure:'#16a34a', thermal:'#0891b2', viewpoint:'#ca8a04', transport:'#475569', area:'#dc2626', hotel:'#0f766e', other:'#64748b' }

function markerState(place: TripPlace) {
  if (place.category === 'hotel') {
    return { color: markerColors.hotel, scale: 1.2, opacity: 1, order: null as number | null, localTip: false, opening: 'unknown' as const }
  }
  const concreteDaySelected = activeTab.value !== 'places' && tripDays.value.some(day => day.day_date === selectedDay.value)
  const isInSelectedDay = concreteDaySelected && place.planned_day === selectedDay.value
  let color = markerColors[place.category || 'other'] || markerColors.other
  let scale = place.is_local_tip ? 1.12 : 1
  let opacity = 1
  if (concreteDaySelected) {
    if (isInSelectedDay) {
      color = '#2f625d'
      scale = 1.16
    }
  }
  // Visited places remain visible when they belong to the selected day.
  // Filtering, not opacity, decides whether a marker belongs on the map.
  const opening = statusForPlace(place)
  if (activeTab.value === 'places' && opening === 'closed') opacity = 0.42
  return { color, scale, opacity, order: isInSelectedDay ? dayStopNumber('place:' + place.id) : null, localTip: Boolean(place.is_local_tip), opening }
}

function markerContent(place: TripPlace) {
  const category = place.category || 'other'
  const state = markerState(place)
  const marker = document.createElement('div')
  marker.className = 'v3-place-marker'
  marker.dataset.placeId = place.id
  marker.style.setProperty('--marker-color', state.color)
  marker.style.setProperty('--marker-scale', String(state.scale))
  marker.style.opacity = String(state.opacity)
  marker.dataset.opening = state.opening
  marker.title = place.name

  const pin = document.createElement('span')
  pin.className = 'v3-place-marker__pin'
  const icon = document.createElement('span')
  icon.className = 'v3-place-marker__icon'
  if (state.order != null) {
    icon.classList.add('v3-place-marker__order')
    icon.textContent = String(state.order)
  } else if (state.localTip) {
    icon.classList.add('v3-place-marker__star')
    icon.textContent = '★'
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
  // Keep the existing AdvancedMarker instances stable. MarkerClusterer tracks
  // those object identities; replacing them during search/edit can leave the
  // newly created marker detached until another filter change.
  for (const place of places.value) {
    const marker = markers.get(place.id)
    const element = markerElements.get(place.id)
    if (!marker || !element) continue
    const state = markerState(place)
    element.style.setProperty('--marker-color', state.color)
    element.style.setProperty('--marker-scale', String(state.scale))
    element.style.opacity = String(state.opacity)
    element.dataset.opening = state.opening
    element.title = place.name

    const icon = element.querySelector('.v3-place-marker__icon') as HTMLElement | null
    const labelElement = element.querySelector('.v3-place-marker__label') as HTMLElement | null
    if (icon) {
      icon.className = 'v3-place-marker__icon'
      if (state.order != null) {
        icon.classList.add('v3-place-marker__order')
        icon.textContent = String(state.order)
      } else if (state.localTip) {
        icon.classList.add('v3-place-marker__star')
        icon.textContent = '★'
      } else {
        icon.innerHTML = markerSvg(place.category || 'other')
      }
    }
    if (labelElement) labelElement.textContent = place.name
    marker.title = place.name
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

function closePlacePopup() {
  cancelPendingPlaceFocus()
  activeActivity.value = null
  activityPosition.value = null
  infoWindow?.close()
  activePlace.value = null
  editingPlace.value = false
  selectedPlaceId.value = null
  syncSelectedMarker()
}

let pendingPlaceFocus: ReturnType<typeof setTimeout> | null = null
let pendingPlaceFallback: ReturnType<typeof setTimeout> | null = null
let pendingPlaceIdle: { remove: () => void } | null = null
let placeFocusSequence = 0
function cancelPendingPlaceFocus() {
  placeFocusSequence++
  if (pendingPlaceFocus !== null) clearTimeout(pendingPlaceFocus)
  pendingPlaceFocus = null
  if (pendingPlaceFallback !== null) clearTimeout(pendingPlaceFallback)
  pendingPlaceFallback = null
  pendingPlaceIdle?.remove()
  pendingPlaceIdle = null
}
function focusDayPlace(place: TripPlace) {
  if (!map || place.latitude == null || place.longitude == null) {
    openPlace(place, true)
    return
  }
  closePlacePopup()
  const sequence = placeFocusSequence
  map.panTo({ lat: Number(place.latitude), lng: Number(place.longitude) })
  map.setZoom(Math.max(map.getZoom() || 0, 16))
  const reveal = () => {
    if (sequence !== placeFocusSequence) return
    pendingPlaceIdle?.remove()
    pendingPlaceIdle = null
    if (pendingPlaceFallback !== null) clearTimeout(pendingPlaceFallback)
    pendingPlaceFallback = null
    pendingPlaceFocus = setTimeout(() => {
      pendingPlaceFocus = null
      if (sequence === placeFocusSequence) openPlace(place, false)
    }, 200)
  }
  pendingPlaceIdle = map.addListener('idle', reveal)
  pendingPlaceFallback = setTimeout(reveal, 1800)
}
function openPlace(place: TripPlace, focus = false) {
  cancelPendingPlaceFocus()
  activeActivity.value = null
  activityPosition.value = null
  if (!map) return
  const marker = markers.get(place.id)
  if (!marker) return
  activePlace.value = place
  popupDay.value = place.planned_day || ''
  popupStart.value = place.start_time || ''
  popupEnd.value = place.end_time || ''
  selectedPlaceId.value = place.id
  syncSelectedMarker()
  if (place.latitude != null && place.longitude != null) {
    map.panTo({ lat: Number(place.latitude), lng: Number(place.longitude) })
    if (focus) map.setZoom(Math.max(map.getZoom() || 0, 16))

  }
}

const planningSaving = ref(false)
const planningError = ref('')
let planningQueue = Promise.resolve()
function savePlanning() {
  const place = activePlace.value
  const trip = trips.currentTrip
  if (!place || !trip) return
  const placeId = place.id
  const dayDate = popupDay.value
  const start = dayDate ? popupStart.value || null : null
  const end = dayDate ? popupEnd.value || null : null
  const day = tripDays.value.find(item => item.day_date === dayDate)
  const previousDay = place.planned_day
  const order = day ? (previousDay === dayDate ? place.planned_order : Math.max(0, ...places.value.filter(item => item.planned_day === dayDate).map(item => item.planned_order || 0)) + 1) : null
  planningSaving.value = true
  planningError.value = ''
  planningQueue = planningQueue.catch(() => {}).then(async () => {
    const current = places.value.find(item => item.id === placeId)
    if (!current) return
    try {
      await updateTripPlacePlanning(trip.id, current, day?.id || null, order, start, end)
      current.planned_day = day?.day_date || null
      current.planned_order = order
      current.start_time = start
      current.end_time = end
      refreshMarkerAppearances()
    } catch (cause) {
      planningError.value = cause instanceof Error ? cause.message : 'Automatisches Speichern fehlgeschlagen.'
    }
  }).finally(() => { planningSaving.value = false })
}
watch([popupDay, popupStart, popupEnd], () => {
  if (activePlace.value && !editingPlace.value) savePlanning()
})
let realtimeChannel: RealtimeChannel | null = null
let realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null
async function refreshRemotePlaces() {
  const trip = trips.currentTrip
  if (!trip || planningSaving.value || dayPlanSaving.value || stopDrag) {
    scheduleRealtimeRefresh()
    return
  }
  try {
    const fresh = await listTripPlaces(trip.id)
    await loadActivities()
    const byId = new Map(fresh.map(place => [place.id, place]))
    places.value = fresh
    if (activePlace.value) {
      const updated = byId.get(activePlace.value.id)
      if (updated) {
        activePlace.value = updated
        popupDay.value = updated.planned_day || ''
        popupStart.value = updated.start_time || ''
        popupEnd.value = updated.end_time || ''
      } else closePlacePopup()
    }
    refreshMarkerAppearances()
    syncMarkerVisibility()
  } catch (cause) {
    console.error('Realtime-Aktualisierung fehlgeschlagen', cause)
  }
}
function scheduleRealtimeRefresh() {
  cancelPendingPlaceFocus()
  if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = setTimeout(() => { realtimeRefreshTimer = null; void refreshRemotePlaces() }, 450)
}

async function toggleVisited() {
  const place = activePlace.value; const trip = trips.currentTrip
  if (!place || !trip) return
  place.visited = !place.visited
  const day = tripDays.value.find(item => item.day_date === place.planned_day)
  await updateTripPlacePlanning(trip.id, place, day?.id || null, place.planned_order, place.start_time, place.end_time, place.visited)
  refreshMarkerAppearances()
}

async function savePlaceEdit() {
  const place = activePlace.value
  if (!place) return
  const previousLat = place.latitude
  const previousLng = place.longitude
  const addressChanged = (place.address || '').trim() !== editOriginalAddress.value.trim()
  let position: { lat: number; lng: number } | null = null
  if (addressChanged && place.address?.trim()) {
    position = await geocodeDestination(place.address.trim())
  }
  await updatePlaceDetails(place, {
    name: place.name, address: place.address || '', category: place.category || 'other',
    note: place.note || '', isLocalTip: Boolean(place.is_local_tip),
    latitude: position?.lat, longitude: position?.lng,
  })
  const trip = trips.currentTrip
  if (trip) {
    if (place.category === 'hotel') {
      if (!place.stay_from || !place.stay_until || place.stay_until < place.stay_from) return
      await updateTripPlaceStay(trip.id, place.id, place.stay_from, place.stay_until)
      place.planned_day = null; place.planned_order = null; place.start_time = null; place.end_time = null; place.visited = false
    } else if (place.stay_from || place.stay_until) {
      await updateTripPlaceStay(trip.id, place.id, null, null)
      place.stay_from = null; place.stay_until = null
    }
  }
  if (position) {
    place.latitude = position.lat
    place.longitude = position.lng
  }
  editingPlace.value = false
  let marker = markers.get(place.id)
  if (marker && position) {
    // MarkerClusterer keeps its own spatial state. Recreate the marker so the
    // new coordinates are reflected immediately instead of only after reload.
    marker.map = null
    markers.delete(place.id)
    markerElements.delete(place.id)
    const { AdvancedMarkerElement } = await getMarkerLibrary()
    marker = new AdvancedMarkerElement({
      map: placeMarkerClusterer ? null : map, position, title: place.name, content: markerContent(place), gmpClickable: true,
      zIndex: place.category === 'hotel' ? 900 : place.is_local_tip ? 100 : 1,
    })
    marker.addEventListener('gmp-click', () => openPlace(place))
    markers.set(place.id, marker)
  }
  refreshMarkerAppearances()
  if (position && (previousLat !== position.lat || previousLng !== position.lng)) {
    map?.panTo(position)
    window.requestAnimationFrame(() => {
      map?.panBy(0, 0)
      window.dispatchEvent(new Event('resize'))
    })
  }
}

async function removeActivePlace() {
  const place = activePlace.value; const trip = trips.currentTrip
  if (!place || !trip || !confirm(`„${place.name}“ wirklich aus der Reise löschen?`)) return
  await deleteTripPlace(trip.id, place.id)
  const marker = markers.get(place.id); if (marker) marker.map = null
  markers.delete(place.id); markerElements.delete(place.id)
  places.value = places.value.filter(item => item.id !== place.id)
  closePlacePopup(); syncMarkerVisibility()
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

  if (placeMarkerClusterer) {
    // First clear the clusterer's current rendering, including cluster markers.
    // clearMarkers(true) deliberately skips rendering, so excluded AdvancedMarkers
    // must also be detached explicitly to avoid stale markers on the map.
    placeMarkerClusterer.clearMarkers()
    for (const [id, marker] of markers) {
      if (visibleIds.has(id)) {
        visibleMarkers.push(marker)
      } else {
        marker.map = null
      }
    }
    placeMarkerClusterer.addMarkers(visibleMarkers)
  } else {
    for (const [id, marker] of markers) {
      marker.map = visibleIds.has(id) ? map : null
    }
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
  tripCenter = center
  const googleMaps = getGoogleMaps()
  const { AdvancedMarkerElement } = await getMarkerLibrary()
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID
  if (!mapId) throw new Error('Google-Maps-Karten-ID fehlt.')
  map = new googleMaps.Map(mapHost.value, {
    center, zoom: 12, mapId, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
  })
  infoWindow = new googleMaps.InfoWindow({ disableAutoPan: true })
  map.addListener('click', () => { closePlacePopup(); mobilePlacesOpen.value = false })
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

function fitMapToSelectedDay() {
  if (!map) return
  const googleMaps = getGoogleMaps()
  const bounds = new googleMaps.LatLngBounds()
  let count = 0
  let singlePosition: { lat: number; lng: number } | null = null
  const include = (lat: number | null, lng: number | null) => {
    if (lat == null || lng == null) return
    const latitude = Number(lat)
    const longitude = Number(lng)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    singlePosition = { lat: latitude, lng: longitude }
    bounds.extend(singlePosition)
    count++
  }
  for (const place of visiblePlaces.value) include(place.latitude, place.longitude)
  if (activeTab.value !== 'places' && selectedDayRecord.value) {
    for (const activity of activities.value) {
      if (activity.trip_day_id === selectedDayRecord.value.id) include(activity.latitude, activity.longitude)
    }
  }
  if (count > 1) map.fitBounds(bounds, 72)
  else if (count === 1) {
    if (singlePosition) map.panTo(singlePosition)
    map.setZoom(15)
  } else if (tripCenter) {
    map.panTo(tripCenter)
    map.setZoom(12)
  }
}

watch(visiblePlaces, () => syncMarkerVisibility(), { flush: 'post' })
watch(activeTab, async () => {
  refreshMarkerAppearances()
  await refreshActivityMarkers()
  fitMapToSelectedDay()
})
watch(selectedDay, async () => {
  cancelPendingPlaceFocus()
  closePlacePopup()
  activeActivity.value = null
  activityPosition.value = null
  refreshMarkerAppearances()
  await refreshActivityMarkers()
  fitMapToSelectedDay()
})



onMounted(async () => {
  openingClockTimer = setInterval(() => { openingClockTick.value++; refreshMarkerAppearances() }, 60_000)
  requestUserLocation()
  try {
    await restoreTrip()
    if (!trips.currentTrip) { await router.replace('/trips'); return }
    ;[places.value, tripDays.value] = await Promise.all([listTripPlaces(trips.currentTrip.id), listTripDays(trips.currentTrip.id)])
    await loadActivities()
    await nextTick()
    await renderMap()
    await refreshActivityMarkers()
    realtimeChannel = supabase.channel('v3-trip-places-' + trips.currentTrip.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_places', filter: 'trip_id=eq.' + trips.currentTrip.id }, scheduleRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_activities', filter: 'trip_id=eq.' + trips.currentTrip.id }, scheduleRealtimeRefresh)
      .subscribe()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Orte konnten nicht geladen werden.'
  } finally { loading.value = false }
})
onUnmounted(() => {
  stopNavigationTracking()
  hideWalkingRoute()
  if (openingClockTimer) clearInterval(openingClockTimer)
  if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer)
  if (realtimeChannel) void supabase.removeChannel(realtimeChannel)
  for (const marker of activityMarkers.values()) marker.map = null
})
</script>

<template>
  <main class="trip-workspace">
    <header class="trip-header" :class="{ 'trip-header--mobile-hidden': mobilePlacesOpen }">
      <div><p class="auth-card__eyebrow">Travel Planner v3 · Orte & Karte</p><h1>{{ trips.currentTrip?.name }}</h1><p>{{ trips.currentTrip?.destination }} · {{ places.length }} Orte</p></div>
      <button type="button" class="trip-header__trips-button" @click="router.push('/trips')">↔ Reise wechseln</button>
    </header>
    <p v-if="error" class="trip-error">{{ error }}</p>
    <nav class="workspace-tabs" aria-label="Reisebereiche">
      <button v-for="tab in ([{ id: 'today', name: 'Heute', icon: '➤' }, { id: 'plan', name: 'Plan', icon: '▦' }, { id: 'places', name: 'Orte', icon: '⌖' }, { id: 'tools', name: 'Werkzeuge', icon: '⚙' }] as const)" :key="tab.id" type="button" :class="{ 'workspace-tabs__active': activeTab === tab.id }" @click="openWorkspaceTab(tab.id)"><span aria-hidden="true">{{ tab.icon }}</span>{{ tab.name }}</button>
    </nav>
    <section class="trip-map-layout" :class="{ 'trip-map-layout--places-open': mobilePlacesOpen }">
      <aside class="places-panel" :class="{ 'places-panel--open': mobilePlacesOpen }">
        <div class="mobile-sheet-handle" aria-hidden="true"></div>
        <div class="mobile-panel-head">
          <strong>{{ activeTab === 'plan' ? 'Tagesplanung' : activeTab === 'places' ? 'Alle Orte' : activeTab === 'today' ? 'Heute' : 'Werkzeuge' }}</strong>
          <button type="button" class="mobile-close" @click="mobilePlacesOpen = false">✕</button>
        </div>
        <template v-if="activeTab === 'places'">
        <div class="places-panel__heading">
          <h2>Orte <span class="count-badge">{{ visiblePlaces.length }} / {{ places.length }}</span></h2>
        </div>
        <input v-model="searchQuery" class="place-search" type="search" placeholder="Orte durchsuchen …">
        <div class="places-panel__toolbar">
          <button type="button" class="place-add-button" @click="openAddPlace">＋ Ort hinzufügen</button>
          <button type="button" class="place-sort-button" :class="{ 'place-sort-button--active': sortByDistance }" @click="sortByDistance = !sortByDistance">{{ sortByDistance ? 'A–Z Alphabetisch sortieren' : '📍 Nach Entfernung sortieren' }}</button>
          <select v-model="selectedCategory" aria-label="Kategorie filtern">
            <option value="all">Alle Kategorien</option>
            <option v-for="category in categories" :key="category" :value="category">{{ label(category) }}</option>
          </select>
        </div>
        <p v-if="loading">Orte werden geladen …</p>
        <p v-else-if="!visiblePlaces.length" class="muted">Keine Orte gefunden.</p>
        <button v-for="place in visiblePlaces" :key="place.id" class="place-row" type="button" @click="openPlace(place, true); mobilePlacesOpen = false"><span class="place-row__content"><span class="place-row__title"><strong>{{ place.name }}</strong><span v-if="place.visited" class="badge">Besucht</span></span><small class="place-row__meta">{{ label(place.category || 'other') }} · {{ place.planned_day || 'Noch offen' }}</small></span></button>
        </template>
        <template v-if="activeTab === 'plan' || activeTab === 'today'">
          <div v-if="activeTab === 'plan'" class="places-panel__toolbar">
          <select v-model="selectedDay" aria-label="Orte nach Reisetag filtern">
            <option value="unplanned">Noch offen</option>
            <option v-for="day in tripDays" :key="day.id" :value="day.day_date">{{ new Date(day.day_date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) }}</option>
          </select>
        </div>
        <div v-if="activeTab === 'today' && todayIsTripDay" class="today-day-navigation" aria-label="Reisetag wechseln"><button type="button" aria-label="Vorheriger Reisetag" title="Vorheriger Reisetag" :disabled="todayDayIndex <= 0" @click="moveTodayDay(-1)">‹</button><div><strong>Tag {{ todayDayIndex + 1 }} von {{ orderedTripDays.length }}</strong><span>{{ new Date(selectedDay + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) }}</span></div><button type="button" aria-label="Nächster Reisetag" title="Nächster Reisetag" :disabled="todayDayIndex < 0 || todayDayIndex >= orderedTripDays.length - 1" @click="moveTodayDay(1)">›</button></div>
        <div v-if="activeTab === 'today' && todayIsTripDay" class="today-route-controls"><strong>Tagesroute</strong><div class="today-mobility-picker" role="group" aria-label="Verkehrsmittel"><button type="button" :class="{ 'today-mobility-picker__active': routeMode === 'auto' }" :aria-pressed="routeMode === 'auto'" @click="routeMode = 'auto'" title="Automatische Kombination aus Fußweg und ÖPNV">✨ Kombi</button><button type="button" :class="{ 'today-mobility-picker__active': routeMode === 'walking' }" :aria-pressed="routeMode === 'walking'" @click="routeMode = 'walking'">🚶 Fuß</button><button type="button" :class="{ 'today-mobility-picker__active': routeMode === 'transit' }" :aria-pressed="routeMode === 'transit'" @click="routeMode = 'transit'">🚇 ÖPNV</button></div><label for="today-route-start">Startpunkt</label><select id="today-route-start" v-model="routeStart"><option value="location">Aktueller Standort</option><option value="first">Erster Stopp</option><option value="hotel">Unterkunft</option></select><label for="today-route-end">Endpunkt</label><select id="today-route-end" v-model="routeEnd"><option value="location">Aktueller Ort</option><option value="hotel">Unterkunft</option><option value="last">Letzter geplanter Stopp</option></select><button type="button" class="place-add-button" :disabled="routeBusy" @click="toggleWalkingRoute">{{ routeBusy ? 'Route wird berechnet …' : routeVisible ? 'Route ausblenden' : routeMode === 'auto' ? 'Automatische Route anzeigen' : routeMode === 'transit' ? 'ÖPNV-Route anzeigen' : 'Fußroute anzeigen' }}</button><p v-if="routeSummary" class="muted">{{ routeSummary }}</p><div v-if="routeMode !== 'walking' && transitMetrics.some(metric => metric.mode === 'transit')" class="today-transit-refresh"><button type="button" :disabled="transitRefreshBusy || routeBusy" @click="refreshTransitConnections">{{ transitRefreshBusy ? 'Aktualisiere …' : '↻ ÖPNV aktualisieren' }}</button><small v-if="transitLastUpdated">Zuletzt abgefragt: {{ transitLastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }} Uhr</small><small v-if="transitRefreshNotice" role="status">{{ transitRefreshNotice }}</small></div><p v-if="routeError" class="trip-error" role="alert">{{ routeError }}</p></div>
        <section v-if="activeTab === 'today' && todayIsTripDay" class="today-navigation-v3" aria-label="Tagesnavigation">
          <strong>🧭 Tagesnavigation</strong>
          <p v-if="navigationState === 'idle'" class="muted">GPS-Begleitung für die geplanten Stopps. Die Abbiegeführung folgt in einem nächsten Schritt.</p>
          <template v-else>
            <p><strong>{{ navigationState === 'paused' ? 'Pausiert' : 'GPS aktiv' }}</strong><span v-if="navigationAccuracy !== null"> · Genauigkeit ca. {{ navigationAccuracy }} m</span></p>
            <p v-if="navigationTarget">Nächstes Ziel: <strong>{{ navigationTarget.name }}</strong> ({{ navigationTargetIndex + 1 }} von {{ dayStops.length }})</p><p v-if="navigationDistance !== null && navigationDuration !== null">🧭 {{ legDistance(navigationDistance) }} · {{ legDuration(navigationDuration) }} · Ankunft ca. {{ new Date(Date.now() + navigationDuration).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }} Uhr</p><p v-if="navigationRouting" class="muted">Route zum nächsten Ziel wird berechnet …</p><div v-if="navigationArrived" class="today-navigation-v3__arrival" role="status"><strong>📍 Ziel erreicht!</strong><p>{{ navigationTarget?.name }} ist erreicht.</p><button type="button" @click="confirmNavigationArrivalV3">{{ navigationTargetIndex >= dayStops.length - 1 ? 'Navigation abschließen' : 'Weiter zum nächsten Stopp →' }}</button></div>
          </template>
          <div class="today-navigation-v3__actions">
            <button v-if="navigationState === 'idle'" type="button" @click="startDayNavigationV3">▶ Navigation starten</button>
            <button v-if="navigationState === 'active'" type="button" @click="pauseDayNavigationV3">⏸ Pausieren</button>
            <button v-if="navigationState === 'paused'" type="button" @click="resumeDayNavigationV3">▶ Fortsetzen</button>
            <button v-if="navigationState !== 'idle'" type="button" :disabled="navigationTargetIndex >= dayStops.length - 1" @click="nextNavigationStopV3">Nächster Stopp →</button>
            <button v-if="navigationState !== 'idle'" type="button" @click="stopDayNavigationV3">■ Beenden</button>
          </div>
          <p v-if="navigationMessage" class="trip-error" role="status">{{ navigationMessage }}</p>
        </section>
        <div v-if="activeTab === 'today' && todayIsTripDay" class="today-summary"><strong>{{ todayCompletedCount }} von {{ dayStops.length }} Orten besucht</strong><p v-if="todayNextStop" class="muted">Nächster Stopp: {{ todayNextStop.name }}</p><p v-else class="muted">Alle geplanten Stopps abgeschlossen.</p><button v-if="todayNextStop" type="button" class="place-add-button" @click="focusTodayStop(todayNextStop)">➤ Nächsten Stopp anzeigen</button></div>
        <button v-if="trips.canEditContent && activeTab === 'plan'" type="button" class="place-add-button" @click="openActivityDialog()">＋ Aktivität hinzufügen</button>
        <div v-if="selectedDayRecord && activeTab === 'plan'" ref="dayPlanList" class="day-plan-preview"><strong>{{ new Date(selectedDay + "T12:00:00").toLocaleDateString("de-DE", { weekday:"long", day:"2-digit", month:"long" }) }}</strong><p v-if="!dayStops.length" class="muted">Noch keine Stopps geplant.</p><div v-for="(stop, index) in renderedDayStops" :key="stop.id" class="day-plan-stop" :class="{ 'day-plan-stop--dragging': stopDrag?.sourceId === stop.id }" :data-day-stop-id="stop.id"><span class="day-plan-stop__handle" aria-label="Stopp verschieben" @pointerdown="onStopPointerDown($event, stop.id)" @pointermove="onStopPointerMove" @pointerup="onStopPointerEnd($event)" @pointercancel="onStopPointerEnd($event, true)">⠿</span><button type="button" class="day-plan-stop__place" @click="stop.activity ? focusActivity(stop.activity) : (stop.place && focusDayPlace(stop.place)); mobilePlacesOpen = false"><span>{{ index + 1 }}.</span><span>{{ stop.kind === "activity" ? "🎟️ " : "" }}{{ stop.name }}<small v-if="stop.start_time || stop.end_time">{{ stop.start_time || "–" }} – {{ stop.end_time || "–" }}</small></span></button><button v-if="stop.activity && trips.canEditContent" type="button" class="day-plan-stop__edit" title="Aktivität bearbeiten" aria-label="Aktivität bearbeiten" @click="openActivityDialog(stop.activity)">✎</button></div><p v-if="dayPlanError" class="trip-error">{{ dayPlanError }}</p></div>
        <div v-if="selectedDayRecord && activeTab === 'today'" class="day-plan-preview">
          <strong>{{ new Date(selectedDay + "T12:00:00").toLocaleDateString("de-DE", { weekday:"long", day:"2-digit", month:"long" }) }}</strong>
          <p v-if="!dayStops.length" class="muted">Noch keine Stopps geplant.</p>
          <template v-for="(entry, index) in routeAgendaStops" :key="entry.key">
            <div class="day-plan-stop">
              <span>{{ entry.stop?.place?.visited ? '✓' : index + 1 + '.' }}</span>
              <button v-if="entry.stop" type="button" class="day-plan-stop__place" @click="focusTodayStop(entry.stop)"><span>{{ entry.stop.kind === 'activity' ? '🎟️ ' : '' }}{{ entry.name }}<small v-if="entry.stop.start_time || entry.stop.end_time">{{ entry.stop.start_time || '–' }} – {{ entry.stop.end_time || '–' }}</small></span></button>
              <span v-else class="day-plan-stop__place">{{ entry.name }}</span>
              <span v-if="entry.stop?.place?.visited" class="badge">Besucht</span>
            </div>
            <div v-if="index < routeAgendaStops.length - 1 && transitMetrics[index]" class="today-leg">
              <div v-if="transitMetrics[index]?.mode === 'walking'" class="today-leg__summary">
                <span class="today-leg__icon">🚶</span>
                <span class="today-leg__body"><strong>{{ legDuration(transitMetrics[index].durationMillis) }}</strong><small>{{ legDistance(transitMetrics[index].distanceMeters) }} · Fußweg zum nächsten Stopp</small></span>
              </div>
              <details v-else class="today-leg__details">
                <summary class="today-leg__summary">
                  <span class="today-leg__icon">🚇</span>
                  <span class="today-leg__body"><strong>{{ legDuration(transitMetrics[index].durationMillis) }}</strong><small>{{ legDistance(transitMetrics[index].distanceMeters) }} · ÖPNV zum nächsten Stopp</small></span>
                  <span class="today-leg__expand">Details <span aria-hidden="true">⌄</span></span>
                </summary>
                <div class="today-leg__connections"><p v-if="transitChangeWarnings[index + 1]" class="today-transit-warning" role="status">{{ transitChangeWarnings[index + 1] }}</p>
                  <div v-for="(connection, connectionIndex) in transitLegs.get(index + 1) || []" :key="connectionIndex" class="today-leg__connection">
                    <strong>{{ connection.icon }} {{ connection.line }}<span v-if="connection.headsign"> · {{ connection.headsign }}</span></strong>
                    <small v-if="connection.departure || connection.arrival">{{ connection.departure || '–' }}–{{ connection.arrival || '–' }} Uhr<span v-if="connection.stops"> · {{ connection.stops }} Haltestellen</span></small>
                    <small>📍 {{ connection.from || 'Einstieg' }} → {{ connection.to || 'Ausstieg' }}</small>
                  </div>
                  <p v-if="!transitLegs.get(index + 1)?.length" class="muted">Keine Linien- oder Haltestellendetails verfügbar.</p><a :href="transitMapsUrl(index)" target="_blank" rel="noopener noreferrer" class="today-transit-maplink">🚇 Aktuelle Verbindung in Google Maps öffnen ↗</a>
                </div>
              </details>
            </div>
          </template>
        </div>

        <p v-if="loading">Orte werden geladen …</p>
        <p v-else-if="activeTab === 'today' && !selectedDayRecord" class="muted">Für diese Reise sind noch keine Reisetage angelegt.</p>
        <p v-else-if="activeTab === 'plan' && !selectedDayRecord && !visiblePlaces.length" class="muted">Keine Orte in dieser Auswahl.</p>
        <button v-for="place in (activeTab === 'today' || selectedDayRecord ? [] : visiblePlaces)" :key="place.id" class="place-row" :class="{ 'place-row--active': selectedPlaceId === place.id }" type="button" @click="openPlace(place, true); mobilePlacesOpen = false">
          <span class="place-row__content">
            <span class="place-row__title"><strong>{{ place.name }}</strong><span v-if="place.visited" class="badge">Besucht</span></span>
            <small class="place-row__meta">{{ label(place.category || 'other') }}<template v-if="place.address"> · {{ place.address }}</template></small>
            <small v-if="place.note" class="place-row__note">{{ place.note }}</small>
          </span>
        </button>
        </template>
        <template v-if="activeTab === 'tools'">
          <p class="muted">Verfügbare Reisefunktionen</p>
          <button type="button" class="place-sort-button" @click="centerOnDestination(); mobilePlacesOpen = false">📍 Auf Reiseziel zentrieren</button>
          <button type="button" class="place-sort-button" @click="centerOnCurrentLocation(); mobilePlacesOpen = false">◎ Aktuellen Standort anzeigen</button>
          <button type="button" class="place-sort-button" @click="fitAllPlaces(); mobilePlacesOpen = false">⌗ Alle Orte auf der Karte</button>
          <button type="button" class="place-sort-button" @click="router.push('/trips')">Reise wechseln</button>
        </template>
      </aside>
      <section class="map-panel">
        <div v-if="navigationState === 'idle'" class="map-mobile-actions">
          <button type="button" @click="openWorkspaceTab(activeTab)">☰ {{ activeTab === 'plan' ? 'Plan' : activeTab === 'places' ? 'Orte' : activeTab === 'today' ? 'Heute' : 'Werkzeuge' }}</button>
          <button type="button" class="map-mobile-trips" @click="router.push('/trips')" aria-label="Reise wechseln">Reisen</button>
        </div>
        <div ref="mapHost" class="trip-map" aria-label="Karte der Reise"></div>
        <section v-if="navigationState !== 'idle'" class="navigation-map-overlay" aria-label="Aktive Navigation" role="region">
          <div class="navigation-map-overlay__headline"><span>🧭 {{ navigationState === 'paused' ? 'Navigation pausiert' : navigationArrived ? '📍 Ziel erreicht' : 'Navigation aktiv' }}</span><strong>{{ navigationTarget?.name || 'Nächster Stopp' }}</strong></div>
          <p v-if="navigationDistance !== null && navigationDuration !== null">{{ legDistance(navigationDistance) }} · {{ legDuration(navigationDuration) }} · Ankunft ca. {{ new Date(Date.now() + navigationDuration).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }} Uhr</p>
          <p v-else-if="navigationRouting">Route wird berechnet …</p>
          <p v-if="navigationMessage" role="status">{{ navigationMessage }}</p>
          <div class="navigation-map-overlay__actions"><button type="button" @click="showNavigationMapMode(navigationMapMode === 'follow' ? 'overview' : 'follow')">{{ navigationMapMode === 'follow' ? '⌗ Gesamtroute' : '◎ Mir folgen' }}</button>
            <button v-if="navigationArrived" type="button" @click="confirmNavigationArrivalV3">{{ navigationTargetIndex >= dayStops.length - 1 ? 'Abschließen' : 'Nächster Stopp →' }}</button>
            <button v-if="navigationState === 'active'" type="button" @click="pauseDayNavigationV3">⏸ Pause</button>
            <button v-if="navigationState === 'paused'" type="button" @click="resumeDayNavigationV3">▶ Weiter</button>
            <button v-if="!navigationArrived" type="button" :disabled="navigationTargetIndex >= dayStops.length - 1" @click="nextNavigationStopV3">Stopp überspringen →</button>
            <button type="button" @click="stopDayNavigationV3">■ Beenden</button>
          </div>
        </section>
        <div v-if="navigationState === 'idle'" class="map-toolbar">
          <button type="button" :title="'Karte auf ' + (trips.currentTrip?.destination || 'Reiseziel') + ' zentrieren'" @click="centerOnDestination">📍 {{ trips.currentTrip?.destination || 'Reiseziel' }}</button>
          <button type="button" title="Aktueller Standort" @click="centerOnCurrentLocation">◎ Standort</button>
          <button type="button" title="Alle Orte anzeigen" @click="fitAllPlaces">⌗ Alle</button>
          <button type="button" class="map-toolbar__add" @click="openAddPlace">＋ Ort</button>
        </div>
        <div v-if="activeActivity" class="place-popup" @click.stop>
          <button class="place-popup__close" type="button" @click="closePlacePopup">✕</button>
          <h3>🎟️ {{ activeActivity.name }}</h3>
          <p class="muted">{{ activeActivity.start_time?.slice(0,5) }} · {{ activeActivity.meeting_place_name }}</p>
          <p v-if="activeActivity.address">{{ activeActivity.address }}</p>
          <p v-if="!activityPosition" class="muted">Für diesen Treffpunkt sind keine Kartenkoordinaten hinterlegt.</p>
          
        </div>
        <div v-if="activePlace" ref="placePopup" class="place-popup" :class="{ 'place-popup--editing': editingPlace }" @click.stop>
          <button class="place-popup__close" type="button" @click="closePlacePopup">✕</button>
          <template v-if="!editingPlace">
            <h3>{{ activePlace.name }}</h3>
            <p class="muted place-popup__meta">{{ label(activePlace.category || 'other') }}<template v-if="activePlace.is_local_tip"> · ⭐ Local-Tipp</template><template v-if="activePlace.planned_order"> · #{{ activePlace.planned_order }}</template></p>
            <p v-if="activePlace.address" class="place-popup__address">{{ activePlace.address }}</p>
            <p v-if="activePlaceDistance != null" class="place-popup__distance">📍 {{ distanceLabel(activePlaceDistance) }}</p>
            <p v-if="activePlace.note">{{ activePlace.note }}</p>
            <div v-if="activePlace.opening_hours || activePlace.phone || activePlace.website" class="place-popup__details">
              <div v-if="activePlace.opening_hours">🕒 {{ activePlace.opening_hours }}</div>
              <a v-if="activePlace.phone" :href="'tel:' + activePlace.phone.replace(/[^\\d+]/g, '')">📞 {{ activePlace.phone }}</a>
              <a v-if="activePlace.website" :href="activePlace.website" target="_blank" rel="noopener">🌐 Website öffnen</a>
            </div>
            <a class="popup-button popup-button--maps" :href="'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(activePlace.name + ' ' + (activePlace.address || ''))" target="_blank" rel="noopener">Google Maps öffnen</a>
            <template v-if="activePlace.category === 'hotel'">
              <div class="place-popup__stay-summary">
                <strong>Aufenthalt</strong>
                <span v-if="activePlace.stay_from && activePlace.stay_until">{{ new Date(activePlace.stay_from + 'T12:00:00').toLocaleDateString('de-DE') }} – {{ new Date(activePlace.stay_until + 'T12:00:00').toLocaleDateString('de-DE') }}</span>
                <span v-else class="muted">Noch kein Aufenthaltszeitraum festgelegt</span>
              </div>
            </template>
            <template v-else>
              <label>Reisetag<select v-model="popupDay"><option value="">Noch offen</option><option v-for="day in tripDays" :key="day.id" :value="day.day_date">{{ new Date(day.day_date + 'T12:00:00').toLocaleDateString('de-DE') }}</option></select></label>
              <div v-if="popupDay" class="place-popup__times"><label>Von<input v-model="popupStart" type="time"></label><label>Bis<input v-model="popupEnd" type="time"></label></div>
            </template>
            <div class="place-popup__actions">
              <p v-if="activePlace.category !== 'hotel'" class="muted">{{ planningSaving ? 'Speichert automatisch …' : 'Änderungen werden automatisch gespeichert' }}</p><p v-if="planningError" class="trip-error">{{ planningError }}</p>
              <button v-if="activePlace.category !== 'hotel'" class="popup-button popup-button--status" :class="{ 'popup-button--visited': activePlace.visited }" type="button" @click="toggleVisited"><span class="popup-button__icon">{{ activePlace.visited ? '✓' : '○' }}</span><span>{{ activePlace.visited ? 'Besucht' : 'Als besucht markieren' }}</span></button>
              <button class="popup-button popup-button--edit" type="button" @click="editOriginalAddress = activePlace.address || ''; editingPlace = true"><span class="popup-button__icon">✎</span><span>Bearbeiten</span></button>
              <button class="popup-button popup-button--danger" type="button" @click="removeActivePlace">Aus Reise löschen</button>
            </div>
          </template>
          <template v-else>
            <h3>Ort bearbeiten</h3>
            <label>Name<input v-model="activePlace.name"></label>
            <label>Adresse<input v-model="activePlace.address"></label>
            <label>Kategorie<select v-model="activePlace.category"><option v-for="category in placeCategories" :key="category" :value="category">{{ label(category) }}</option></select></label>
            <div v-if="activePlace.category === 'hotel'" class="place-popup__times"><label>Aufenthalt von<input v-model="activePlace.stay_from" type="date" :min="trips.currentTrip?.start_date" :max="trips.currentTrip?.end_date"></label><label>Aufenthalt bis<input v-model="activePlace.stay_until" type="date" :min="activePlace.stay_from || trips.currentTrip?.start_date" :max="trips.currentTrip?.end_date"></label></div>
            <label>Notiz<textarea v-model="activePlace.note"></textarea></label>
            <label class="place-popup__check"><input v-model="activePlace.is_local_tip" type="checkbox"> Local-Tipp</label>
            <button class="popup-button popup-button--primary" type="button" @click="savePlaceEdit">Änderungen speichern</button>
            <button class="popup-button" type="button" @click="editingPlace = false">Abbrechen</button>
          </template>
        </div>
      </section>
    </section>
    <div v-if="activityOpen" class="place-dialog-backdrop" @click.self="activityOpen = false">
      <form class="place-dialog activity-form" role="dialog" aria-modal="true" aria-label="Aktivität hinzufügen" @submit.prevent="createActivity">
        <h2>{{ editingActivityId ? "Aktivität bearbeiten" : "Aktivität hinzufügen" }}</h2>
        <label>Name<input v-model="activityName" required></label>
        <label>Reisetag<select v-model="activityDayId" required><option v-for="day in tripDays" :key="day.id" :value="day.id">{{ day.day_date }}</option></select></label>
        <label>Beginn<input v-model="activityStart" type="time" required></label>
        <label>Treffpunkt über Google suchen<div ref="activityPlaceHost" class="google-place-host"></div></label>
        <p v-if="activityPlaceError" class="muted">{{ activityPlaceError }}</p>
        <p v-if="activityMeeting" class="muted">Ausgewählt: {{ activityMeeting }}</p>
        <p v-if="activityAddress" class="muted">{{ activityAddress }}</p>
        <p v-if="activityError" class="trip-error">{{ activityError }}</p>
        <div class="place-dialog__actions"><button v-if="editingActivityId" type="button" :disabled="activitySaving" @click="deleteActivity">Löschen</button><button type="button" @click="activityOpen = false">Abbrechen</button><button type="submit" :disabled="activitySaving">{{ activitySaving ? 'Speichern …' : 'Aktivität speichern' }}</button></div>
      </form>
    </div>
    <div v-if="addPlaceOpen" class="place-dialog-backdrop" @click.self="addPlaceOpen = false">
      <section class="place-dialog" role="dialog" aria-modal="true" aria-label="Ort hinzufügen">
        <button class="place-dialog__close" type="button" @click="addPlaceOpen = false">✕</button>
        <p class="auth-card__eyebrow">Gemeinsame Reisedatenbank</p>
        <h2>Ort hinzufügen</h2>
        <label>Auf Google Maps suchen<div ref="addPlaceHost" class="google-place-host"></div></label>
        <div class="place-dialog__divider">oder manuell eingeben</div>
        <label>Name<input v-model="addPlaceName" type="text"></label>
        <label>Adresse<input v-model="addPlaceAddress" type="text"></label>
        <label>Kategorie<select v-model="addPlaceCategory"><option v-for="category in placeCategories" :key="category" :value="category">{{ label(category) }}</option></select></label>
        <div v-if="addPlaceCategory === 'hotel'" class="place-dialog__stay"><label>Aufenthalt von<input v-model="addPlaceStayFrom" type="date" :min="trips.currentTrip?.start_date" :max="trips.currentTrip?.end_date"></label><label>Aufenthalt bis<input v-model="addPlaceStayUntil" type="date" :min="addPlaceStayFrom || trips.currentTrip?.start_date" :max="trips.currentTrip?.end_date"></label></div>
        <label v-else>Reisetag<select v-model="addPlaceDay"><option value="">Noch offen</option><option v-for="day in tripDays" :key="day.id" :value="day.day_date">{{ new Date(day.day_date + 'T12:00:00').toLocaleDateString('de-DE') }}</option></select></label>
        <label>Notiz<textarea v-model="addPlaceNote"></textarea></label>
        <label class="place-dialog__check"><input v-model="addPlaceLocalTip" type="checkbox"> ⭐ Als Local-Tipp markieren</label>
        <p v-if="addPlaceMessage" :class="addPlaceDuplicateId ? 'place-dialog__duplicate' : 'muted'">{{ addPlaceMessage }}</p>
        <div class="place-dialog__actions"><button type="button" @click="addPlaceOpen = false">Abbrechen</button><button class="popup-button--primary" type="button" :disabled="addPlaceSaving" @click="saveNewPlace">{{ addPlaceSaving ? 'Speichern …' : 'Ort speichern' }}</button></div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.trip-header__trips-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;border:1px solid #cbdad6;border-radius:11px;background:#fff;color:#245b53;font:700 .9rem Inter,ui-sans-serif,system-ui,sans-serif;box-shadow:0 2px 6px rgba(15,23,42,.06);cursor:pointer;transition:background .15s ease,border-color .15s ease}.trip-header__trips-button:hover{background:#edf7f4;border-color:#8fb9ae}.trip-header__trips-button:focus-visible{outline:3px solid #a6d4c8;outline-offset:2px}
.workspace-tabs{max-width:1400px;margin:0 auto 12px;display:flex;gap:8px}.workspace-tabs button{display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 16px;border:1px solid #dce4e7;border-radius:12px;background:#fff;color:#26323d;cursor:pointer}.workspace-tabs .workspace-tabs__active{background:#2f625d;color:#fff;border-color:#2f625d}

:global(.v3-activity-pin){display:grid;place-items:center;min-width:32px;height:32px;padding:0 3px;border:3px solid #fff;border-radius:50%;background:#7c3aed;color:white;font:800 14px Inter,system-ui,sans-serif;box-shadow:0 2px 8px #0005;cursor:pointer}.day-plan-stop__edit{border:1px solid #dce5e2;border-radius:9px;background:white;color:#2f625d;min-width:36px;cursor:pointer}

.activity-form label{display:grid;gap:5px;margin:10px 0}.activity-form input,.activity-form select{width:100%;padding:9px;border:1px solid #ccd4dc;border-radius:8px;box-sizing:border-box}

.trip-workspace{min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;background:#f6f7f9}.trip-header{max-width:1400px;margin:0 auto 18px;display:flex;align-items:center;justify-content:space-between;gap:16px}.trip-header h1{margin:4px 0}.trip-header p{margin:0}.trip-map-layout{max-width:1400px;margin:auto;display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:16px;height:calc(100vh - 150px);min-height:560px}.places-panel,.map-panel{background:#fff;border:1px solid #dde2e8;border-radius:18px;overflow:hidden}.places-panel{padding:16px;overflow:auto}.places-panel__heading h2{margin:0 0 10px;display:flex;align-items:center;gap:8px}.count-badge{font-size:.72rem;color:#65717d;background:#f2f4f7;border:1px solid #e1e5ea;border-radius:999px;padding:3px 8px}.place-search{box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border:1px solid #d8dee6;border-radius:11px;background:#f8f9fb;color:inherit;font:inherit}.places-panel__toolbar{margin-bottom:12px;display:grid;gap:8px}.place-add-button,.place-sort-button{width:100%;padding:9px 10px;border:1px solid #d8dee6;border-radius:10px;background:#fff;color:#26323d;text-align:left;cursor:pointer}.place-add-button{background:#2f625d;color:#fff;border-color:#2f625d}.place-sort-button--active{background:#edf7f4;border-color:#b8d4ce;color:#245b53}.places-panel__toolbar select{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d8dee6;border-radius:10px;background:#fff}.trip-workspace button,.trip-workspace select{font:inherit}.trip-workspace button{font-weight:700}.place-row{width:100%;display:block;text-align:left;padding:10px 11px;margin:0 0 7px;background:#f8f9fb;border:1px solid #e1e5ea;border-radius:12px;color:inherit;cursor:pointer;transition:transform .12s ease,border-color .12s ease,background .12s ease}.place-row:hover{transform:translateY(-1px);border-color:#c7ced7;background:#fff}.place-row--active{border-color:#2f625d;background:#fff;box-shadow:0 0 0 2px rgba(47,98,93,.08)}.place-row__content{display:block;min-width:0}.place-row__title{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.place-row strong{font-size:.9rem}.place-row small{display:block;overflow-wrap:anywhere}.place-row__meta{margin-top:4px;color:#65717d;font-size:.75rem}.place-row__note{margin-top:6px;color:#56616d;font-size:.75rem;line-height:1.35}.place-row .badge{margin:0;flex:0 0 auto;font-size:.68rem}.map-panel{position:relative}.map-toolbar{position:absolute;z-index:5;left:14px;top:14px;display:flex;gap:7px;flex-wrap:wrap}.map-toolbar button{padding:8px 10px;border:1px solid rgba(0,0,0,.12);border-radius:10px;background:rgba(255,255,255,.96);box-shadow:0 3px 12px rgba(0,0,0,.12);color:#26323d;cursor:pointer}.map-toolbar .map-toolbar__add{background:#2f625d;color:#fff;border-color:#2f625d}.trip-map{width:100%;height:100%;min-height:500px}.trip-error{max-width:1400px;margin:0 auto 16px;color:#a21d1d}.muted{color:#65717d}.mobile-sheet-handle,.mobile-panel-head,.map-mobile-actions{display:none}
:global(.v3-place-marker){position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;transform:translateY(-4px) scale(var(--marker-scale,1));transform-origin:50% 70%;isolation:isolate}
:global(.v3-place-marker__pin){position:relative;width:36px;height:36px;display:grid;place-items:center;border:3px solid #fff;border-radius:50%;background:var(--marker-color,#64748b);box-shadow:0 2px 7px rgba(15,23,42,.32);transition:transform .14s ease,box-shadow .14s ease}
:global(.v3-place-marker__icon){display:grid;place-items:center;width:20px;height:20px;color:#fff}
:global(.v3-place-marker__icon svg){width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
:global(.v3-place-marker__label){position:absolute;left:50%;top:44px;max-width:190px;padding:5px 8px;border:1px solid rgba(15,23,42,.12);border-radius:7px;background:rgba(255,255,255,.97);box-shadow:0 2px 8px rgba(15,23,42,.15);color:#172033;font:700 11px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transform:translateX(-50%)}

:global(.v3-place-marker--hotel .v3-place-marker__pin){width:40px;height:40px}

 :global(.v3-place-marker[data-opening='open'] .v3-place-marker__pin){outline:4px solid #16a34a;outline-offset:1px}
:global(.v3-place-marker[data-opening='closed'] .v3-place-marker__pin){outline:4px solid #dc2626;outline-offset:1px}
:global(.v3-place-marker[data-opening='unknown'] .v3-place-marker__pin){outline:3px solid #94a3b8;outline-offset:1px}
:global(.v3-place-marker__order),:global(.v3-place-marker__star){font-size:15px;font-weight:800;color:#fff}



:global(.v3-place-marker--selected){z-index:1100!important}
:global(.v3-place-marker--selected .v3-place-marker__pin){transform:scale(1.14);box-shadow:0 0 0 4px rgba(255,255,255,.95),0 4px 12px rgba(15,23,42,.42)}
:global(.v3-place-marker--selected .v3-place-marker__label){opacity:1}


:global(.v3-marker-cluster){min-width:38px;height:38px;padding:0 10px;border:3px solid rgba(255,255,255,.96);border-radius:999px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;background:#2f625d;color:#fff;font:700 14px/1 Inter,ui-sans-serif,system-ui,sans-serif;box-shadow:0 3px 10px rgba(15,23,42,.28);transform:translateY(-2px);user-select:none;cursor:pointer}
:global(.v3-map-info){font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:260px;line-height:1.4}
:global(.v3-map-info strong){display:block;margin-bottom:4px;font-size:15px}
.place-popup{position:absolute;z-index:8;right:18px;top:18px;width:min(360px,calc(100% - 36px));max-height:calc(100% - 36px);overflow:auto;box-sizing:border-box;padding:18px;border:1px solid #dce2e8;border-radius:14px;background:#fff;box-shadow:0 12px 34px rgba(15,23,42,.22)}.place-popup h3{margin:0 32px 5px 0}.place-popup__close{position:absolute;right:10px;top:10px;border:0;background:transparent}.place-popup label{display:grid;gap:5px;margin:10px 0;font-size:.82rem;font-weight:700}.place-popup input,.place-popup select,.place-popup textarea{box-sizing:border-box;width:100%;padding:8px;border:1px solid #ccd4dc;border-radius:8px;background:#fff}.place-popup textarea{min-height:72px;resize:vertical}.place-dialog__duplicate{margin:8px 0;padding:10px 12px;border:1px solid #e2a33a;border-radius:10px;background:#fff8e8;color:#7a4a00;font-weight:700}.place-popup__times,.place-dialog__stay{display:grid;grid-template-columns:1fr 1fr;gap:8px}.place-popup__stay-summary{display:grid;gap:4px;margin:12px 0;padding:10px 12px;border:1px solid #d8dee6;border-radius:10px;background:#f8f9fb;font-size:.82rem}.place-popup__stay-summary span{font-weight:600}.place-popup>button:not(.place-popup__close){margin:5px 5px 0 0}.place-popup__check{display:flex!important;grid-template-columns:none!important;align-items:center;gap:8px!important}.place-popup__check input{width:auto}.popup-button{min-height:42px;padding:9px 12px;margin:5px 5px 0 0;border:1px solid #cbd3db;border-radius:10px;background:#f7f8fa;color:#26323d;cursor:pointer}.popup-button--primary{border-color:#2f625d;background:#2f625d;color:#fff}.popup-button--danger{border-color:#efc5c5;background:#fff7f7;color:#a21d1d}.place-popup__close{border-radius:50%;cursor:pointer}.place-popup__actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.place-popup__actions .popup-button{width:100%;min-width:0;margin:0}.place-popup__actions .popup-button--primary,.place-popup__actions .popup-button--status{grid-column:1/-1}.popup-button--full{width:100%;margin-right:0}.popup-button--status,.popup-button--edit{display:flex;align-items:center;justify-content:flex-start;gap:7px;width:100%;margin-right:0;text-align:left;white-space:nowrap}.popup-button__icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;font-size:1rem}.popup-button--visited{border-color:#b8d4ce;background:#edf7f4;color:#245b53;font-weight:700}.popup-button--edit{background:#fff}.place-popup__distance{color:#2f625d;font-weight:700}.place-popup__details{display:grid;gap:7px;margin:10px 0;padding-top:10px;border-top:1px solid #e4e7eb;font-size:.84rem;line-height:1.35}.place-popup__details a{color:#2f625d;font-weight:700;text-decoration:none}.place-popup__meta{margin-bottom:2px!important}.place-popup__address{margin-top:2px!important}.popup-button--maps{display:inline-flex;width:auto;box-sizing:border-box;align-items:center;justify-content:flex-start;text-align:left;font-weight:700;text-decoration:none;border-color:#cbd3db;background:#fff;color:#2f625d}
.today-route-controls{display:grid;gap:8px;margin:10px 0;padding:12px;border:1px solid #d8e3e0;border-radius:12px;background:#f4f8f7}.today-route-controls label{font-size:.82rem;font-weight:700}.today-route-controls select{width:100%;min-height:40px;padding:8px;border:1px solid #b9d3cc;border-radius:8px;background:#fff}.today-route-controls button:disabled{opacity:.65;cursor:wait}
.today-day-navigation{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:10px;margin:10px 0;padding:10px;border:1px solid #d8e3e0;border-radius:12px;background:#f4f8f7}.today-day-navigation>div{display:grid;gap:3px;min-width:0;text-align:center}.today-day-navigation strong{font-weight:800;color:#245b53}.today-day-navigation span{font-size:.85rem;color:#53636a}.today-day-navigation button{width:44px;height:44px;border:1px solid #b9d3cc;border-radius:10px;background:#fff;color:#245b53;font-size:1.8rem;cursor:pointer}.today-day-navigation button:disabled{opacity:.3;cursor:not-allowed}
.day-plan-preview{display:grid;gap:8px;margin:10px 0;padding:12px;border:1px solid #d8e3e0;border-radius:12px;background:#f6faf9}.day-plan-stop{display:flex;align-items:stretch;gap:6px;border-radius:9px}.day-plan-stop--dragging{opacity:.18}.day-plan-ghost--out{opacity:0!important;transition:opacity 120ms ease}.day-plan-ghost{position:fixed;z-index:9999;pointer-events:none;opacity:.97;box-shadow:0 16px 35px #0003;border-radius:9px;background:white;display:flex;gap:6px}.day-plan-ghost .day-plan-stop__place{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid #dce5e2;border-radius:9px;background:white;padding:9px}.day-plan-stop__handle{display:grid;place-items:center;min-width:38px;border:1px solid #dce5e2;border-radius:9px;background:#fff;cursor:grab;touch-action:none;user-select:none;font-size:23px;color:#526b66}.day-plan-stop__handle:active{cursor:grabbing}.day-plan-stop__place{flex:1;min-width:0}.day-plan-preview .day-plan-stop__place{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid #dce5e2;border-radius:9px;background:white;padding:9px;cursor:pointer}.day-plan-preview .day-plan-stop__place small{display:block;color:#66746f;margin-top:3px}
.place-dialog-backdrop{position:fixed;z-index:50;inset:0;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.45)}.place-dialog{position:relative;width:min(520px,100%);max-height:calc(100dvh - 40px);overflow:auto;box-sizing:border-box;padding:22px;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.3)}.place-dialog h2{margin:4px 0 16px}.place-dialog>label{display:grid;gap:6px;margin:11px 0;font-size:.84rem;font-weight:700}.place-dialog input,.place-dialog select,.place-dialog textarea{box-sizing:border-box;width:100%;padding:9px;border:1px solid #ccd4dc;border-radius:9px;background:#fff;font:inherit}.place-dialog textarea{min-height:72px}.place-dialog__close{position:absolute;right:12px;top:12px;border:0;background:transparent;cursor:pointer}.place-dialog__check{display:flex!important;align-items:center;gap:8px!important}.place-dialog__check input{width:auto}.place-dialog__divider{text-align:center;color:#7a8590;font-size:.76rem;margin:12px 0}.google-place-host{margin-top:6px;min-height:44px;max-width:100%;overflow:visible}.google-place-host gmp-place-autocomplete{display:block;width:100%;max-width:100%;box-sizing:border-box}.place-dialog__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.place-dialog__actions button{min-height:40px;padding:8px 12px;border:1px solid #cbd3db;border-radius:10px;background:#fff;cursor:pointer}.place-dialog__actions .popup-button--primary{background:#2f625d;color:#fff;border-color:#2f625d}
@media(max-width:760px){.place-dialog-backdrop{padding:12px}.place-dialog{width:calc(100vw - 24px);max-width:none;padding:18px;overflow-x:visible}.place-dialog>*{min-width:0;max-width:100%;box-sizing:border-box}.google-place-host{display:block;width:100%;max-width:100%;min-width:0;overflow:visible;contain:inline-size}.google-place-host gmp-place-autocomplete{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;overflow:visible!important}.google-place-host gmp-place-autocomplete::part(input){width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trip-workspace{position:fixed;inset:0;padding:0;background:#fff;overflow:hidden;overscroll-behavior:none}.workspace-tabs{position:fixed;z-index:25;bottom:0;left:0;right:0;max-width:none;margin:0;gap:0;padding:7px 5px max(7px,env(safe-area-inset-bottom));background:#fff;box-shadow:0 -3px 14px #0002;display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.workspace-tabs button{border:0;border-radius:9px;padding:6px 2px;flex-direction:column;gap:2px;font-size:.73rem!important}.workspace-tabs button span{font-size:1.25rem}.workspace-tabs .workspace-tabs__active{background:#e8f2ef;color:#245b53}.places-panel{bottom:62px!important;top:12px!important;height:auto!important;max-height:none!important}.trip-header{display:none}.trip-map-layout{position:absolute;inset:0;display:block;height:auto;min-height:0;margin:0}.map-panel{position:absolute;inset:0;height:auto;border:0;border-radius:0;overflow:hidden}.trip-map{position:absolute;inset:0;width:100%;height:auto;min-height:0}.map-toolbar{top:62px;left:12px;right:12px}.map-toolbar button{font-size:.76rem;padding:7px 8px}.map-mobile-actions{display:flex;position:absolute;left:12px;right:12px;top:12px;z-index:4;gap:8px}.map-mobile-trips{margin-left:auto}.map-mobile-actions button{border:1px solid rgba(0,0,0,.1);border-radius:12px;background:rgba(255,255,255,.96);padding:10px 13px;box-shadow:0 5px 18px rgba(0,0,0,.15);color:#172033}.map-mobile-actions span{margin-left:5px;color:#65717d}.places-panel{display:block;position:fixed;z-index:20;inset:12px 0 62px 0;width:100%;height:auto;max-height:none;box-sizing:border-box;border:0;border-radius:20px 20px 0 0;padding:12px 16px max(20px,env(safe-area-inset-bottom));background:#fff;box-shadow:0 -10px 34px rgba(0,0,0,.18);transform:translateY(105%);transition:transform .2s ease;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.places-panel--open{transform:translateY(0)}.mobile-sheet-handle{display:block;width:42px;height:4px;margin:0 auto 12px;border-radius:999px;background:#d2d7dd}.mobile-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;font-size:1.08rem}.mobile-close{border:0;background:transparent;font-size:1.15rem;padding:6px;color:#34404c}.places-panel__heading h2{font-size:1rem;margin-bottom:10px}.place-row{padding:10px}.place-popup{position:fixed;z-index:15;left:auto;right:12px;top:82px;bottom:auto;width:min(78vw,320px);max-height:min(52dvh,460px);padding:12px;overflow-y:auto;overscroll-behavior:contain;border-radius:14px}.place-popup--editing{width:min(90vw,390px);max-height:calc(100dvh - 170px)}.place-popup h3{font-size:1rem;line-height:1.2;margin-bottom:3px}.place-popup p{font-size:.82rem;line-height:1.3;margin:5px 0}.place-popup label{margin:9px 0 5px}.place-popup input,.place-popup select{min-height:38px;padding:7px 9px}.place-popup__times{gap:8px}.popup-button{min-height:38px;padding:7px 10px;font-size:.8rem}.place-popup__actions{grid-template-columns:1fr;gap:7px}.place-popup__actions .popup-button--primary,.place-popup__actions .popup-button--status,.place-popup__actions .popup-button--edit,.place-popup__actions .popup-button--danger{grid-column:1;width:100%;justify-content:flex-start;text-align:left;white-space:nowrap}.place-popup__actions .popup-button--primary{justify-content:center;text-align:center}.popup-button--status,.popup-button--edit{font-size:.78rem}.trip-error{position:fixed;z-index:30;left:12px;right:12px;top:12px;background:#fff;padding:10px;border-radius:10px}}
</style>

<style scoped>
.today-mobility-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; padding: 4px; background: #e8eeeb; border-radius: 12px; }
.today-mobility-picker button { min-width: 0; padding: 10px 4px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: #314f4a; font: inherit; font-size: 0.88rem; font-weight: 650; cursor: pointer; }
.today-mobility-picker button.today-mobility-picker__active { background: #fff; border-color: #aac6bd; box-shadow: 0 1px 4px #244d4220; }
.today-leg { margin: 5px 0 12px 20px; padding-left: 12px; border-left: 2px solid #d4e0db; min-width: 0; }
.today-leg__details { min-width: 0; }
.today-leg__summary { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 9px 10px; border: 1px solid #dce6e1; border-radius: 10px; background: #f5f8f6; list-style: none; }
.today-leg__details > summary { cursor: pointer; }
.today-leg__details > summary::-webkit-details-marker { display: none; }
.today-leg__icon { flex: 0 0 24px; text-align: center; font-size: 1.15rem; }
.today-leg__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; line-height: 1.4; }
.today-leg__body strong { font-size: 0.92rem; }
.today-leg__body small { font-size: 0.8rem; color: #596c65; }
.today-leg__expand { flex: 0 0 auto; font-size: 0.75rem; color: #38675b; white-space: nowrap; }
.today-leg__details[open] .today-leg__expand span { display: inline-block; transform: rotate(180deg); }
.today-leg__connections { padding: 8px 9px 4px; }
.today-leg__connection { display: flex; flex-direction: column; gap: 5px; padding: 10px 3px; border-bottom: 1px solid #e0e9e5; overflow-wrap: anywhere; line-height: 1.4; }
.today-leg__connection:last-child { border-bottom: 0; }
.today-leg__connection strong { font-size: 0.87rem; }
.today-leg__connection small { font-size: 0.79rem; color: #556a63; }
</style>

<style scoped>
.today-transit-refresh { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.today-transit-refresh button { padding:8px 12px; border:1px solid #a6c8bf; background:white; border-radius:8px; font:inherit; cursor:pointer; }
.today-transit-refresh button:disabled { opacity:.6; cursor:wait; }
.today-transit-refresh small { color:#596c65; }
.today-transit-warning { margin:4px 0 8px; padding:8px; border-radius:8px; background:#fff3db; color:#78551b; font-size:.8rem; }
.today-transit-maplink { display:inline-block; margin:9px 0; font-size:.84rem; color:#2563eb; overflow-wrap:anywhere; }
</style>

<style scoped>
.today-navigation-v3 { display:grid; gap:8px; margin:10px 0; padding:12px; border:1px solid #b9d3cc; border-radius:12px; background:#f5faf8; }
.today-navigation-v3 p { margin:0; font-size:.87rem; }
.today-navigation-v3__actions { display:flex; gap:7px; flex-wrap:wrap; }
.today-navigation-v3__actions button { padding:9px 11px; border:1px solid #b9d3cc; border-radius:8px; background:white; font:inherit; cursor:pointer; }
.today-navigation-v3__actions button:disabled { opacity:.5; cursor:not-allowed; }
</style>

<style scoped>
.today-navigation-v3__arrival { padding:10px; border:1px solid #90c3a6; border-radius:10px; background:#e9f7ee; }
.today-navigation-v3__arrival button { margin-top:8px; padding:9px 12px; border-radius:8px; border:1px solid #82b89d; background:white; cursor:pointer; }
</style>

<style scoped>
.navigation-map-overlay { position:absolute; z-index:24; left:12px; right:12px; bottom:88px; max-width:480px; margin:0 auto; padding:12px 14px; background:rgba(255,255,255,.97); border:1px solid #c7d9d3; border-radius:15px; box-shadow:0 4px 18px #0003; color:#233b35; }
.navigation-map-overlay__headline { display:flex; flex-direction:column; gap:3px; font-size:.82rem; }
.navigation-map-overlay__headline strong { font-size:1rem; overflow-wrap:anywhere; }
.navigation-map-overlay p { margin:6px 0; font-size:.82rem; }
.navigation-map-overlay__actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
.navigation-map-overlay__actions button { font:inherit; font-size:.8rem; border:1px solid #b8cdc6; background:#f6faf8; border-radius:8px; padding:8px 10px; cursor:pointer; }
.navigation-map-overlay__actions button:disabled { opacity:.5; cursor:not-allowed; }
@media (min-width: 768px) { .navigation-map-overlay { bottom:22px; } }
</style>

<style scoped>
.navigation-map-overlay { top: max(12px, env(safe-area-inset-top)); bottom:auto; left:50%; right:auto; transform:translateX(-50%); width:calc(100% - 24px); max-width:520px; box-sizing:border-box; padding:12px; z-index:24; }
.navigation-map-overlay__headline { text-align:center; gap:2px; }
.navigation-map-overlay__headline strong { font-size:1.08rem; }
.navigation-map-overlay > p { text-align:center; font-size:.85rem; }
.navigation-map-overlay__actions { justify-content:center; }
.navigation-map-overlay__actions button { padding:8px 9px; }
@media (min-width:768px) { .navigation-map-overlay { top:16px; bottom:auto; } }
</style>
