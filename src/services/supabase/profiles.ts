import { supabase } from './client'

export interface Profile {
  id: string
  username: string | null
}

export async function getCurrentProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,username')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function updateUsername(userId: string, username: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ username }).eq('id', userId)
  if (error) {
    if (error.code === '23505') throw new Error('Dieser Benutzername ist bereits vergeben.')
    throw error
  }
}

export async function isAppAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_app_admin')
  if (error) throw error
  return Boolean(data)
}
