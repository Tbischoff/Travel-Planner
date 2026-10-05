import { supabase } from './client'

export interface TripPlace {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  category: string | null
  note: string | null
  is_local_tip: boolean | null
  favorite: boolean | null
  visited: boolean
  planned_day: string | null
  planned_order: number | null
}

export async function listTripPlaces(tripId: string): Promise<TripPlace[]> {
  const { data: relations, error: relationError } = await supabase
    .from('trip_places')
    .select('place_id,visited,trip_day_id,planned_order')
    .eq('trip_id', tripId)
  if (relationError) throw relationError

  const ids = [...new Set((relations ?? []).map((item) => item.place_id).filter(Boolean))]
  if (!ids.length) return []

  const { data: places, error: placesError } = await supabase
    .from('places')
    .select('id,name,address,latitude,longitude,category,note,is_local_tip,favorite')
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
  })) as TripPlace[]
}
