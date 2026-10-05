import { supabase } from './client'
import type { TripRole } from './trips'
export interface TripMember { user_id: string; username: string | null; email: string | null; role: TripRole }
export interface MemberCandidate { id: string; username: string | null }
export async function listTripMembers(tripId: string): Promise<TripMember[]> {
  const { data, error } = await supabase.rpc('get_trip_members', { p_trip_id: tripId })
  if (error) throw error
  return (data ?? []) as TripMember[]
}
export async function listMemberCandidates(tripId: string): Promise<MemberCandidate[]> {
  const { data, error } = await supabase.rpc('get_trip_member_candidates', { p_trip_id: tripId })
  if (error) throw error
  return (data ?? []) as MemberCandidate[]
}
export async function addTripMember(tripId: string, userId: string, role: Exclude<TripRole, 'owner'>): Promise<void> {
  const { error } = await supabase.rpc('add_trip_member_by_user_id', { p_trip_id: tripId, p_user_id: userId, p_role: role })
  if (error) throw error
}
export async function setTripMemberRole(tripId: string, userId: string, role: Exclude<TripRole, 'owner'>): Promise<void> {
  const { error } = await supabase.rpc('set_trip_member_role', { p_trip_id: tripId, p_user_id: userId, p_role: role })
  if (error) throw error
}
export async function removeTripMember(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_trip_member', { p_trip_id: tripId, p_user_id: userId })
  if (error) throw error
}
