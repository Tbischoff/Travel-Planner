import { supabase } from './client'

export interface TripPlace {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  category: string | null
  note: string | null
  website: string | null
  phone: string | null
  opening_hours: string | null
  google_place_id: string | null
  is_local_tip: boolean | null
  favorite: boolean | null
  visited: boolean
  planned_day: string | null
  planned_order: number | null
  start_time: string | null
  end_time: string | null
}

export interface TripDay {
  id: string
  day_date: string
}

export async function listTripDays(tripId: string): Promise<TripDay[]> {
  const { data, error } = await supabase
    .from('trip_days')
    .select('id,day_date')
    .eq('trip_id', tripId)
    .order('day_date')
  if (error) throw error
  return data ?? []
}

export async function listTripPlaces(tripId: string): Promise<TripPlace[]> {
  const { data: relations, error: relationError } = await supabase
    .from('trip_places')
    .select('place_id,visited,trip_day_id,planned_order,planned_time,planned_end_time')
    .eq('trip_id', tripId)
  if (relationError) throw relationError

  const ids = [...new Set((relations ?? []).map((item) => item.place_id).filter(Boolean))]
  if (!ids.length) return []

  const { data: places, error: placesError } = await supabase
    .from('places')
    .select('id,name,address,latitude,longitude,category,note,website,phone,opening_hours,google_place_id,is_local_tip,favorite')
    .in('id', ids)
    .order('name')
  if (placesError) throw placesError

  const dayIds = [...new Set((relations ?? []).map((item) => item.trip_day_id).filter(Boolean))]
  const dayById = new Map<string, string>()
  if (dayIds.length) {
    const { data: days, error: daysError } = await supabase
      .from('trip_days')
      .select('id,day_date')
      .in('id', dayIds)
    if (daysError) throw daysError
    for (const day of days ?? []) dayById.set(day.id, day.day_date)
  }

  const relationByPlace = new Map((relations ?? []).map((item) => [item.place_id, item]))
  return (places ?? []).map((place) => ({
    ...place,
    visited: Boolean(relationByPlace.get(place.id)?.visited),
    planned_day: dayById.get(relationByPlace.get(place.id)?.trip_day_id ?? '') ?? null,
    planned_order: relationByPlace.get(place.id)?.planned_order ?? null,
    start_time: relationByPlace.get(place.id)?.planned_time?.slice(0, 5) ?? null,
    end_time: relationByPlace.get(place.id)?.planned_end_time?.slice(0, 5) ?? null,
  })) as TripPlace[]
}

export async function updateTripPlacePlanning(tripId: string, place: TripPlace, dayId: string | null, order: number | null, startTime: string | null, endTime: string | null, visited = place.visited): Promise<void> {
  const { error } = await supabase.from('trip_places').update({
    trip_day_id: dayId,
    planned_order: order,
    planned_time: startTime || null,
    planned_end_time: endTime || null,
    visited,
  }).eq('trip_id', tripId).eq('place_id', place.id)
  if (error) throw error
}

export async function updatePlaceDetails(place: TripPlace, input: { name: string; address: string; category: string; note: string; isLocalTip: boolean }): Promise<void> {
  const { error } = await supabase.from('places').update({
    name: input.name, address: input.address || null, category: input.category,
    note: input.note || null, is_local_tip: input.isLocalTip,
  }).eq('id', place.id)
  if (error) throw error
}

export async function deleteTripPlace(tripId: string, placeId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_place_from_trip', { p_trip_id: tripId, p_place_id: placeId })
  if (error) throw error
}


export interface NewTripPlaceInput {
  name: string
  address: string
  latitude: number
  longitude: number
  category: string
  note?: string | null
  googlePlaceId?: string | null
  website?: string | null
  phone?: string | null
  openingHours?: string | null
  isLocalTip?: boolean
  dayId?: string | null
  plannedOrder?: number | null
}

export async function addTripPlace(tripId: string, input: NewTripPlaceInput): Promise<string> {
  if (input.googlePlaceId) {
    const { data: status, error: statusError } = await supabase.rpc('get_google_place_status', {
      p_trip_id: tripId,
      p_google_place_id: input.googlePlaceId,
    })
    if (!statusError && status?.in_trip && status.place_id) return status.place_id
    if (!statusError && status?.exists && status.place_id) {
      const { error: linkError } = await supabase.from('trip_places').insert({
        trip_id: tripId,
        place_id: status.place_id,
        trip_day_id: input.dayId || null,
        planned_order: input.plannedOrder ?? null,
      })
      if (linkError) throw linkError
      return status.place_id
    }
  }

  const { data: place, error: placeError } = await supabase.from('places').insert({
    name: input.name,
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    category: input.category,
    google_place_id: input.googlePlaceId || null,
    website: input.website || null,
    phone: input.phone || null,
    opening_hours: input.openingHours || null,
    note: input.note || null,
    is_local_tip: Boolean(input.isLocalTip),
    source: input.googlePlaceId ? 'googlePlaces' : 'manual',
  }).select('id').single()
  if (placeError) throw placeError

  const { error: relationError } = await supabase.from('trip_places').insert({
    trip_id: tripId,
    place_id: place.id,
    trip_day_id: input.dayId || null,
    planned_order: input.plannedOrder ?? null,
  })
  if (relationError) {
    await supabase.from('places').delete().eq('id', place.id)
    throw relationError
  }
  return place.id
}
