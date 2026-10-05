export interface MapInstance {
  fitBounds: (bounds: BoundsInstance, padding?: number) => void
}
export interface BoundsInstance {
  extend: (position: { lat: number; lng: number }) => void
}
export interface MarkerInstance {
  addListener: (event: string, handler: () => void) => void
}
export interface InfoWindowInstance {
  open: (options: { map: MapInstance; anchor: MarkerInstance }) => void
}

interface GoogleMapsApi {
  maps: {
    Geocoder: new () => { geocode: (request: { address: string }) => Promise<{ results?: Array<{ geometry?: { location?: { lat: () => number; lng: () => number } } }> }> }
    Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance
    Marker: new (options: Record<string, unknown>) => MarkerInstance
    InfoWindow: new (options: Record<string, unknown>) => InfoWindowInstance
    LatLngBounds: new () => BoundsInstance
  }
}

declare global {
  interface Window {
    google?: GoogleMapsApi
    __travelPlannerGoogleMapsReady?: () => void
  }
}

let loadPromise: Promise<void> | null = null

export function getGoogleMaps(): GoogleMapsApi['maps'] {
  if (!window.google?.maps) throw new Error('Google Maps ist noch nicht geladen.')
  return window.google.maps
}

export function loadGoogleMaps(): Promise<void> {
  if (window.google?.maps) return Promise.resolve()
  if (loadPromise) return loadPromise
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error('Google-Maps-Konfiguration fehlt.'))
  loadPromise = new Promise((resolve, reject) => {
    window.__travelPlannerGoogleMapsReady = resolve
    const script = document.createElement('script')
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&callback=__travelPlannerGoogleMapsReady&v=weekly&language=de&loading=async'
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Google Maps konnte nicht geladen werden.'))
    document.head.appendChild(script)
  })
  return loadPromise
}

export async function geocodeDestination(destination: string): Promise<{ lat: number; lng: number }> {
  await loadGoogleMaps()
  const geocoder = new (getGoogleMaps().Geocoder)()
  const response = await geocoder.geocode({ address: destination })
  const location = response.results?.[0]?.geometry?.location
  if (!location) throw new Error('Reiseziel konnte nicht gefunden werden.')
  return { lat: location.lat(), lng: location.lng() }
}
