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
}

export async function listTripPlaces(tripId: string): Promise<TripPlace[]> {
  const { data: relations, error: relationError } = await supabase
    .from('trip_places')
    .select('place_id,visited')
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

  const relationByPlace = new Map((relations ?? []).map((item) => [item.place_id, item]))
  return (places ?? []).map((place) => ({
    ...place,
    visited: Boolean(relationByPlace.get(place.id)?.visited),
  })) as TripPlace[]
}
