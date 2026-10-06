<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTripStore } from '../stores/trip'
import { addTripPlace, deleteTripPlace, listTripDays, listTripPlaces, updatePlaceDetails, updateTripPlacePlanning, updateTripPlaceStay, type TripDay, type TripPlace } from '../services/supabase/places'
import { geocodeDestination, getGoogleMaps, getMarkerLibrary, getPlacesLibrary, loadGoogleMaps, type AdvancedMarkerInstance, type InfoWindowInstance, type MapInstance } from '../services/google/maps'

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
const placePopup = ref<HTMLElement | null>(null)
const activePlace = ref<TripPlace | null>(null)
const editingPlace = ref(false)
const editOriginalAddress = ref('')
const popupDay = ref('')
const popupStart = ref('')
const popupEnd = ref('')
const userLocation = ref<{ lat: number; lng: number } | null>(null)
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
const sortByDistance = ref(false)
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
    return categoryMatches && searchMatches
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
      addPlaceMessage.value = 'Google-Ort ausgewählt – Daten werden beim Speichern übernommen.'
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

const markerColors: Record<string,string> = { food:'#f97316', cafe:'#a16207', bar:'#7c3aed', sight:'#2563eb', culture:'#db2777', leisure:'#16a34a', thermal:'#0891b2', viewpoint:'#ca8a04', transport:'#475569', area:'#dc2626', hotel:'#0f766e', other:'#64748b' }

function markerState(place: TripPlace) {
  if (place.category === 'hotel') {
    return { color: markerColors.hotel, scale: 1.2, opacity: 1, order: null as number | null, localTip: false }
  }
  const concreteDaySelected = tripDays.value.some(day => day.day_date === selectedDay.value)
  const isInSelectedDay = concreteDaySelected && place.planned_day === selectedDay.value
  let color = markerColors[place.category || 'other'] || markerColors.other
  let scale = place.is_local_tip ? 1.12 : 1
  let opacity = 1
  if (concreteDaySelected) {
    if (isInSelectedDay) {
      color = '#2f625d'
      scale = 1.16
    } else {
      opacity = 0.35
      scale = 0.92
    }
  }
  if (place.visited) opacity = Math.min(opacity, 0.42)
  return { color, scale, opacity, order: isInSelectedDay ? (place.planned_order || null) : null, localTip: Boolean(place.is_local_tip) }
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
async function refreshMarkerAppearances() {
  const { AdvancedMarkerElement } = await getMarkerLibrary()
  const visibleIds = new Set(visiblePlaces.value.map(place => place.id))
  const rebuiltMarkers: AdvancedMarkerInstance[] = []

  for (const place of places.value) {
    const oldMarker = markers.get(place.id)
    if (!oldMarker || place.latitude == null || place.longitude == null) continue

    // AdvancedMarker content nodes must not be swapped while MarkerClusterer owns
    // the marker. Recreate the marker instead; otherwise the clusterer can keep a
    // detached marker until the next filter/search update.
    oldMarker.map = null
    markerElements.delete(place.id)
    const marker = new AdvancedMarkerElement({
      map: null,
      position: { lat: Number(place.latitude), lng: Number(place.longitude) },
      title: place.name,
      content: markerContent(place),
      gmpClickable: true,
      zIndex: place.category === 'hotel' ? 900 :
        (tripDays.value.some(day => day.day_date === selectedDay.value) && place.planned_day === selectedDay.value)
          ? 500 + (place.planned_order || 0)
          : place.is_local_tip ? 100 : 1,
    })
    marker.addEventListener('gmp-click', () => openPlace(place))
    markers.set(place.id, marker)
    if (visibleIds.has(place.id)) rebuiltMarkers.push(marker)
  }

  syncSelectedMarker()
  if (placeMarkerClusterer) {
    placeMarkerClusterer.clearMarkers(true)
    placeMarkerClusterer.addMarkers(rebuiltMarkers, true)
    placeMarkerClusterer.render()
  } else {
    for (const marker of rebuiltMarkers) marker.map = map
  }
}

function syncSelectedMarker() {
  for (const [id, element] of markerElements) {
    element.classList.toggle('v3-place-marker--selected', id === selectedPlaceId.value)
  }
}

function closePlacePopup() {
  infoWindow?.close()
  activePlace.value = null
  editingPlace.value = false
  selectedPlaceId.value = null
  syncSelectedMarker()
}

function openPlace(place: TripPlace, focus = false) {
  if (!map) return
  const marker = markers.get(place.id)
  if (!marker) return

  // A list/search result can be the only visible place. Make sure its marker is
  // attached immediately before opening the details; the clusterer otherwise
  // may still be between two filter redraws and temporarily hide it.
  if (focus) {
    if (placeMarkerClusterer) {
      placeMarkerClusterer.clearMarkers(true)
      placeMarkerClusterer.addMarkers([marker], true)
      placeMarkerClusterer.render()
    } else {
      marker.map = map
    }
  }

  activePlace.value = place
  popupDay.value = place.planned_day || ''
  popupStart.value = place.start_time || ''
  popupEnd.value = place.end_time || ''
  selectedPlaceId.value = place.id
  syncSelectedMarker()
  if (place.latitude != null && place.longitude != null) {
    map.panTo({ lat: Number(place.latitude), lng: Number(place.longitude) })
    if (focus) map.setZoom(Math.max(map.getZoom() || 0, 16))
    nextTick(() => {
      if (!map || !mapHost.value || !placePopup.value) return
      const mapRect = mapHost.value.getBoundingClientRect()
      const popupRect = placePopup.value.getBoundingClientRect()
      const mobile = window.matchMedia('(max-width: 760px)').matches
      if (mobile) {
        const freeLeft = Math.max(0, popupRect.left - mapRect.left)
        map.panBy(Math.round((mapRect.width - freeLeft) / 2), 0)
      } else {
        const freeWidth = Math.max(0, popupRect.left - mapRect.left)
        map.panBy(Math.round((mapRect.width - freeWidth) / 2), 0)
      }
    })
  }
}

async function savePlanning() {
  const place = activePlace.value
  const trip = trips.currentTrip
  if (!place || !trip) return
  const day = tripDays.value.find(item => item.day_date === popupDay.value)
  let order = place.planned_order
  if (day && place.planned_day !== day.day_date) {
    order = Math.max(0, ...places.value.filter(item => item.planned_day === day.day_date).map(item => item.planned_order || 0)) + 1
  }
  if (!day) order = null
  await updateTripPlacePlanning(trip.id, place, day?.id || null, order, day ? popupStart.value || null : null, day ? popupEnd.value || null : null)
  place.planned_day = day?.day_date || null; place.planned_order = order
  place.start_time = day ? popupStart.value || null : null; place.end_time = day ? popupEnd.value || null : null
  refreshMarkerAppearances()
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
      map, position, title: place.name, content: markerContent(place), gmpClickable: true,
      zIndex: place.category === 'hotel' ? 900 : place.is_local_tip ? 100 : 1,
    })
    marker.addEventListener('gmp-click', () => openPlace(place))
    markers.set(place.id, marker)
  }
  await refreshMarkerAppearances()
  // Editing marker content can temporarily detach an AdvancedMarker from the
  // cluster. Re-run the same visibility pass that a later search input would trigger.
  syncMarkerVisibility()
  window.requestAnimationFrame(() => syncMarkerVisibility())
  if (position) {
    // Force the clusterer to rebuild immediately. Vue's next reactive change
    // (for example typing in search) must not be required to redraw the marker.
    if (placeMarkerClusterer) {
      const visibleIds = new Set(visiblePlaces.value.map(item => item.id))
      const visibleMarkers = [...markers.entries()]
        .filter(([id]) => visibleIds.has(id))
        .map(([, item]) => item)
      placeMarkerClusterer.clearMarkers(true)
      placeMarkerClusterer.addMarkers(visibleMarkers, true)
      placeMarkerClusterer.render()
    } else if (marker) {
      marker.map = map
    }
  } else {
    syncMarkerVisibility()
  }
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
  tripCenter = center
  const googleMaps = getGoogleMaps()
  const { AdvancedMarkerElement } = await getMarkerLibrary()
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID
  if (!mapId) throw new Error('Google-Maps-Karten-ID fehlt.')
  map = new googleMaps.Map(mapHost.value, {
    center, zoom: 12, mapId, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
  })
  infoWindow = new googleMaps.InfoWindow({ disableAutoPan: true })
  map.addListener('click', () => closePlacePopup())
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

watch(visiblePlaces, () => {
  // Wait until Vue has committed the search/filter state before rebuilding the
  // cluster. This prevents a clicked search result from being detached again.
  nextTick(() => syncMarkerVisibility())
}, { flush: 'post' })
watch(selectedDay, () => refreshMarkerAppearances())



onMounted(async () => {
  requestUserLocation()
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
          <button type="button" class="place-add-button" @click="openAddPlace">＋ Ort hinzufügen</button>
          <button type="button" class="place-sort-button" :class="{ 'place-sort-button--active': sortByDistance }" @click="sortByDistance = !sortByDistance">{{ sortByDistance ? 'A–Z Alphabetisch sortieren' : '📍 Nach Entfernung sortieren' }}</button>
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
        <div ref="mapHost" class="trip-map" aria-label="Karte der Reise"></div>
        <div class="map-toolbar">
          <button type="button" :title="'Karte auf ' + (trips.currentTrip?.destination || 'Reiseziel') + ' zentrieren'" @click="centerOnDestination">📍 {{ trips.currentTrip?.destination || 'Reiseziel' }}</button>
          <button type="button" title="Aktueller Standort" @click="centerOnCurrentLocation">◎ Standort</button>
          <button type="button" title="Alle Orte anzeigen" @click="fitAllPlaces">⌗ Alle</button>
          <button type="button" class="map-toolbar__add" @click="openAddPlace">＋ Ort</button>
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
              <button v-if="activePlace.category !== 'hotel'" class="popup-button popup-button--primary" type="button" @click="savePlanning">Planung speichern</button>
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
        <p v-if="addPlaceMessage" class="muted">{{ addPlaceMessage }}</p>
        <div class="place-dialog__actions"><button type="button" @click="addPlaceOpen = false">Abbrechen</button><button class="popup-button--primary" type="button" :disabled="addPlaceSaving" @click="saveNewPlace">{{ addPlaceSaving ? 'Speichern …' : 'Ort speichern' }}</button></div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.trip-workspace{min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;background:#f6f7f9}.trip-header{max-width:1400px;margin:0 auto 18px;display:flex;align-items:center;justify-content:space-between;gap:16px}.trip-header h1{margin:4px 0}.trip-header p{margin:0}.trip-map-layout{max-width:1400px;margin:auto;display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:16px;height:calc(100vh - 150px);min-height:560px}.places-panel,.map-panel{background:#fff;border:1px solid #dde2e8;border-radius:18px;overflow:hidden}.places-panel{padding:16px;overflow:auto}.places-panel__heading h2{margin:0 0 10px;display:flex;align-items:center;gap:8px}.count-badge{font-size:.72rem;color:#65717d;background:#f2f4f7;border:1px solid #e1e5ea;border-radius:999px;padding:3px 8px}.place-search{box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border:1px solid #d8dee6;border-radius:11px;background:#f8f9fb;color:inherit;font:inherit}.places-panel__toolbar{margin-bottom:12px;display:grid;gap:8px}.place-add-button,.place-sort-button{width:100%;padding:9px 10px;border:1px solid #d8dee6;border-radius:10px;background:#fff;color:#26323d;text-align:left;cursor:pointer}.place-add-button{background:#2f625d;color:#fff;border-color:#2f625d}.place-sort-button--active{background:#edf7f4;border-color:#b8d4ce;color:#245b53}.places-panel__toolbar select{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d8dee6;border-radius:10px;background:#fff}.trip-workspace button,.trip-workspace select{font:inherit}.trip-workspace button{font-weight:700}.place-row{width:100%;display:block;text-align:left;padding:10px 11px;margin:0 0 7px;background:#f8f9fb;border:1px solid #e1e5ea;border-radius:12px;color:inherit;cursor:pointer;transition:transform .12s ease,border-color .12s ease,background .12s ease}.place-row:hover{transform:translateY(-1px);border-color:#c7ced7;background:#fff}.place-row--active{border-color:#2f625d;background:#fff;box-shadow:0 0 0 2px rgba(47,98,93,.08)}.place-row__content{display:block;min-width:0}.place-row__title{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.place-row strong{font-size:.9rem}.place-row small{display:block;overflow-wrap:anywhere}.place-row__meta{margin-top:4px;color:#65717d;font-size:.75rem}.place-row__note{margin-top:6px;color:#56616d;font-size:.75rem;line-height:1.35}.place-row .badge{margin:0;flex:0 0 auto;font-size:.68rem}.map-panel{position:relative}.map-toolbar{position:absolute;z-index:5;left:14px;top:14px;display:flex;gap:7px;flex-wrap:wrap}.map-toolbar button{padding:8px 10px;border:1px solid rgba(0,0,0,.12);border-radius:10px;background:rgba(255,255,255,.96);box-shadow:0 3px 12px rgba(0,0,0,.12);color:#26323d;cursor:pointer}.map-toolbar .map-toolbar__add{background:#2f625d;color:#fff;border-color:#2f625d}.trip-map{width:100%;height:100%;min-height:500px}.trip-error{max-width:1400px;margin:0 auto 16px;color:#a21d1d}.muted{color:#65717d}.mobile-sheet-handle,.mobile-panel-head,.map-mobile-actions{display:none}
:global(.v3-place-marker){position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;transform:translateY(-4px) scale(var(--marker-scale,1));transform-origin:50% 70%;isolation:isolate}
:global(.v3-place-marker__pin){position:relative;width:36px;height:36px;display:grid;place-items:center;border:3px solid #fff;border-radius:50%;background:var(--marker-color,#64748b);box-shadow:0 2px 7px rgba(15,23,42,.32);transition:transform .14s ease,box-shadow .14s ease}
:global(.v3-place-marker__icon){display:grid;place-items:center;width:20px;height:20px;color:#fff}
:global(.v3-place-marker__icon svg){width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
:global(.v3-place-marker__label){position:absolute;left:50%;top:44px;max-width:190px;padding:5px 8px;border:1px solid rgba(15,23,42,.12);border-radius:7px;background:rgba(255,255,255,.97);box-shadow:0 2px 8px rgba(15,23,42,.15);color:#172033;font:700 11px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transform:translateX(-50%)}

:global(.v3-place-marker--hotel .v3-place-marker__pin){width:40px;height:40px}

:global(.v3-place-marker__order),:global(.v3-place-marker__star){font-size:15px;font-weight:800;color:#fff}



:global(.v3-place-marker--selected){z-index:1100!important}
:global(.v3-place-marker--selected .v3-place-marker__pin){transform:scale(1.14);box-shadow:0 0 0 4px rgba(255,255,255,.95),0 4px 12px rgba(15,23,42,.42)}
:global(.v3-place-marker--selected .v3-place-marker__label){opacity:1}


:global(.v3-marker-cluster){min-width:38px;height:38px;padding:0 10px;border:3px solid rgba(255,255,255,.96);border-radius:999px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;background:#2f625d;color:#fff;font:700 14px/1 Inter,ui-sans-serif,system-ui,sans-serif;box-shadow:0 3px 10px rgba(15,23,42,.28);transform:translateY(-2px);user-select:none;cursor:pointer}
:global(.v3-map-info){font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:260px;line-height:1.4}
:global(.v3-map-info strong){display:block;margin-bottom:4px;font-size:15px}
.place-popup{position:absolute;z-index:8;right:18px;top:18px;width:min(360px,calc(100% - 36px));max-height:calc(100% - 36px);overflow:auto;box-sizing:border-box;padding:18px;border:1px solid #dce2e8;border-radius:14px;background:#fff;box-shadow:0 12px 34px rgba(15,23,42,.22)}.place-popup h3{margin:0 32px 5px 0}.place-popup__close{position:absolute;right:10px;top:10px;border:0;background:transparent}.place-popup label{display:grid;gap:5px;margin:10px 0;font-size:.82rem;font-weight:700}.place-popup input,.place-popup select,.place-popup textarea{box-sizing:border-box;width:100%;padding:8px;border:1px solid #ccd4dc;border-radius:8px;background:#fff}.place-popup textarea{min-height:72px;resize:vertical}.place-popup__times,.place-dialog__stay{display:grid;grid-template-columns:1fr 1fr;gap:8px}.place-popup__stay-summary{display:grid;gap:4px;margin:12px 0;padding:10px 12px;border:1px solid #d8dee6;border-radius:10px;background:#f8f9fb;font-size:.82rem}.place-popup__stay-summary span{font-weight:600}.place-popup>button:not(.place-popup__close){margin:5px 5px 0 0}.place-popup__check{display:flex!important;grid-template-columns:none!important;align-items:center;gap:8px!important}.place-popup__check input{width:auto}.popup-button{min-height:42px;padding:9px 12px;margin:5px 5px 0 0;border:1px solid #cbd3db;border-radius:10px;background:#f7f8fa;color:#26323d;cursor:pointer}.popup-button--primary{border-color:#2f625d;background:#2f625d;color:#fff}.popup-button--danger{border-color:#efc5c5;background:#fff7f7;color:#a21d1d}.place-popup__close{border-radius:50%;cursor:pointer}.place-popup__actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.place-popup__actions .popup-button{width:100%;min-width:0;margin:0}.place-popup__actions .popup-button--primary,.place-popup__actions .popup-button--status{grid-column:1/-1}.popup-button--full{width:100%;margin-right:0}.popup-button--status,.popup-button--edit{display:flex;align-items:center;justify-content:flex-start;gap:7px;width:100%;margin-right:0;text-align:left;white-space:nowrap}.popup-button__icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;font-size:1rem}.popup-button--visited{border-color:#b8d4ce;background:#edf7f4;color:#245b53;font-weight:700}.popup-button--edit{background:#fff}.place-popup__distance{color:#2f625d;font-weight:700}.place-popup__details{display:grid;gap:7px;margin:10px 0;padding-top:10px;border-top:1px solid #e4e7eb;font-size:.84rem;line-height:1.35}.place-popup__details a{color:#2f625d;font-weight:700;text-decoration:none}.place-popup__meta{margin-bottom:2px!important}.place-popup__address{margin-top:2px!important}.popup-button--maps{display:inline-flex;width:auto;box-sizing:border-box;align-items:center;justify-content:flex-start;text-align:left;font-weight:700;text-decoration:none;border-color:#cbd3db;background:#fff;color:#2f625d}
.place-dialog-backdrop{position:fixed;z-index:50;inset:0;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.45)}.place-dialog{position:relative;width:min(520px,100%);max-height:calc(100dvh - 40px);overflow:auto;box-sizing:border-box;padding:22px;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.3)}.place-dialog h2{margin:4px 0 16px}.place-dialog>label{display:grid;gap:6px;margin:11px 0;font-size:.84rem;font-weight:700}.place-dialog input,.place-dialog select,.place-dialog textarea{box-sizing:border-box;width:100%;padding:9px;border:1px solid #ccd4dc;border-radius:9px;background:#fff;font:inherit}.place-dialog textarea{min-height:72px}.place-dialog__close{position:absolute;right:12px;top:12px;border:0;background:transparent;cursor:pointer}.place-dialog__check{display:flex!important;align-items:center;gap:8px!important}.place-dialog__check input{width:auto}.place-dialog__divider{text-align:center;color:#7a8590;font-size:.76rem;margin:12px 0}.google-place-host{margin-top:6px;min-height:44px;max-width:100%;overflow:visible}.google-place-host gmp-place-autocomplete{display:block;width:100%;max-width:100%;box-sizing:border-box}.place-dialog__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.place-dialog__actions button{min-height:40px;padding:8px 12px;border:1px solid #cbd3db;border-radius:10px;background:#fff;cursor:pointer}.place-dialog__actions .popup-button--primary{background:#2f625d;color:#fff;border-color:#2f625d}
@media(max-width:760px){.place-dialog{width:calc(100vw - 32px);max-width:390px;padding:18px;overflow-x:hidden}.google-place-host{width:100%;max-width:100%;overflow:visible}.google-place-host gmp-place-autocomplete{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important}.google-place-host gmp-place-autocomplete::part(input){width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trip-workspace{position:fixed;inset:0;padding:0;background:#fff;overflow:hidden;overscroll-behavior:none}.trip-header{display:none}.trip-map-layout{position:absolute;inset:0;display:block;height:auto;min-height:0;margin:0}.map-panel{position:absolute;inset:0;height:auto;border:0;border-radius:0;overflow:hidden}.trip-map{position:absolute;inset:0;width:100%;height:auto;min-height:0}.map-toolbar{top:62px;left:12px;right:12px}.map-toolbar button{font-size:.76rem;padding:7px 8px}.map-mobile-actions{display:flex;position:absolute;left:12px;right:12px;top:12px;z-index:4;gap:8px}.map-mobile-trips{margin-left:auto}.map-mobile-actions button{border:1px solid rgba(0,0,0,.1);border-radius:12px;background:rgba(255,255,255,.96);padding:10px 13px;box-shadow:0 5px 18px rgba(0,0,0,.15);color:#172033}.map-mobile-actions span{margin-left:5px;color:#65717d}.places-panel{display:block;position:fixed;z-index:20;inset:0 auto 0 0;width:min(90vw,390px);box-sizing:border-box;border:0;border-radius:0 18px 18px 0;padding:12px 16px 20px;background:#fff;box-shadow:12px 0 34px rgba(0,0,0,.18);transform:translateX(-105%);transition:transform .2s ease;overflow-y:auto}.places-panel--open{transform:translateX(0)}.mobile-sheet-handle{display:block;width:42px;height:4px;margin:0 auto 12px;border-radius:999px;background:#d2d7dd}.mobile-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;font-size:1.08rem}.mobile-close{border:0;background:transparent;font-size:1.15rem;padding:6px;color:#34404c}.places-panel__heading h2{font-size:1rem;margin-bottom:10px}.place-row{padding:10px}.place-popup{position:fixed;z-index:15;left:auto;right:12px;top:82px;bottom:auto;width:min(84vw,360px);max-height:calc(100dvh - 98px);padding:14px;overflow:auto;overscroll-behavior:contain;border-radius:16px}.place-popup--editing{width:min(90vw,390px);max-height:calc(100dvh - 98px)}.place-popup h3{font-size:1rem;line-height:1.2;margin-bottom:3px}.place-popup p{font-size:.82rem;line-height:1.3;margin:5px 0}.place-popup label{margin:9px 0 5px}.place-popup input,.place-popup select{min-height:38px;padding:7px 9px}.place-popup__times{gap:8px}.popup-button{min-height:38px;padding:7px 10px;font-size:.8rem}.place-popup__actions{grid-template-columns:1fr;gap:7px}.place-popup__actions .popup-button--primary,.place-popup__actions .popup-button--status,.place-popup__actions .popup-button--edit,.place-popup__actions .popup-button--danger{grid-column:1;width:100%;justify-content:flex-start;text-align:left;white-space:nowrap}.place-popup__actions .popup-button--primary{justify-content:center;text-align:center}.popup-button--status,.popup-button--edit{font-size:.78rem}.trip-error{position:fixed;z-index:30;left:12px;right:12px;top:12px;background:#fff;padding:10px;border-radius:10px}}
</style>
