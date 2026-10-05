import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './client'

export type AuthFlow = 'invite' | 'recovery'

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export async function signIn(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.user) throw new Error('Anmeldung war erfolgreich, aber es wurde kein Benutzer zurückgegeben.')
  return data.user
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('/reset-password?type=recovery', window.location.origin).toString(),
  })
  if (error) throw error
}

export async function updatePassword(password: string): Promise<User> {
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) throw error
  if (!data.user) throw new Error('Passwort wurde gespeichert, aber es wurde kein Benutzer zurückgegeben.')
  return data.user
}

export function detectAuthFlow(): AuthFlow | null {
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const type = search.get('type') || hash.get('type')
  return type === 'invite' || type === 'recovery' ? type : null
}

export function onAuthStateChange(
  callback: (event: string, session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session))
  return () => data.subscription.unsubscribe()
}
