import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './client'

export type AuthFlow = 'invite' | 'recovery'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface SessionTiming {
  issuedAt: number | null
  expiresAt: number | null
  now: number
  issuedInFutureBySeconds: number
}

export function sessionTiming(session: Session): SessionTiming {
  const payload = decodeJwtPayload(session.access_token)
  const issuedAt = typeof payload?.iat === 'number' ? payload.iat : null
  const expiresAt = typeof payload?.exp === 'number' ? payload.exp : null
  const now = Math.floor(Date.now() / 1000)
  return {
    issuedAt,
    expiresAt,
    now,
    issuedInFutureBySeconds: issuedAt == null ? 0 : Math.max(0, issuedAt - now),
  }
}

export async function waitUntilSessionIsUsable(session: Session): Promise<Session> {
  let current = session
  for (let refreshAttempt = 0; refreshAttempt < 2; refreshAttempt++) {
    const timing = sessionTiming(current)
    if (timing.issuedInFutureBySeconds <= 0) return current
    // A browser/device clock behind the auth server can make a valid token
    // appear to be issued in the future to PostgREST. Wait only for a small,
    // recoverable skew; otherwise refresh once before surfacing the problem.
    if (timing.issuedInFutureBySeconds <= 15) {
      await new Promise(resolve => window.setTimeout(resolve, (timing.issuedInFutureBySeconds + 1) * 1000))
      return current
    }
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) throw error ?? new Error('Supabase-Session konnte nicht erneuert werden.')
    current = data.session
  }
  return current
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) return null
  return waitUntilSessionIsUsable(data.session)
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
