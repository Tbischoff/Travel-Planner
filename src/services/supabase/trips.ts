import { supabase } from './client'

export type TripRole = 'owner' | 'editor' | 'viewer'
export interface Trip {
  id: string
  name: string
  destination: string
  start_date: string
  end_date: string
  updated_at: string | null
  current_user_role: TripRole | null
  sort_position: number | null
}
export interface TripInput { name: string; destination: string; startDate: string; endDate: string }

export async function listTrips(userId: string): Promise<Trip[]> {
  const [{ data: trips, error: tripsError }, { data: memberships, error: membershipsError }, { data: preferences, error: preferencesError }] = await Promise.all([
    supabase.from('trips').select('id,name,destination,start_date,end_date,updated_at'),
    supabase.from('trip_members').select('trip_id,role').eq('user_id', userId),
    supabase.from('trip_user_preferences').select('trip_id,sort_position').eq('user_id', userId)
  ])
  if (tripsError) throw tripsError
  if (membershipsError) throw membershipsError
  if (preferencesError) throw preferencesError
  const roles = new Map((memberships ?? []).map(x => [x.trip_id, x.role as TripRole]))
  const positions = new Map((preferences ?? []).map(x => [x.trip_id, x.sort_position as number | null]))
  return (trips ?? []).map(t => ({ ...t, current_user_role: roles.get(t.id) ?? null, sort_position: positions.get(t.id) ?? null }))
}
export async function createTrip(input: TripInput): Promise<void> {
  const { error } = await supabase.rpc('create_trip', { p_name: input.name, p_destination: input.destination, p_start_date: input.startDate, p_end_date: input.endDate })
  if (error) throw error
}
export async function updateTrip(id: string, input: TripInput): Promise<void> {
  const { error } = await supabase.rpc('update_trip', { p_trip_id: id, p_name: input.name, p_destination: input.destination, p_start_date: input.startDate, p_end_date: input.endDate })
  if (error) throw error
}
export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_trip', { p_trip_id: id })
  if (error) throw error
}
export async function leaveTrip(id: string): Promise<void> {
  const { error } = await supabase.rpc('leave_trip', { p_trip_id: id })
  if (error) throw error
}
