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

/**
 * PostgREST validates JWT iat using server time, not the browser clock.
 * A freshly refreshed token can therefore fail again during server clock skew.
 * Retry only read-only operations, with a short bounded delay; do not refresh
 * a valid token just because PostgREST considers its iat in the future.
 */
let pendingFutureJwtRecovery: Promise<void> | null = null
const pause = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))
function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'object' && cause !== null && 'message' in cause) return String(cause.message)
  return String(cause)
}
export async function withSessionRecovery<T>(read: () => Promise<T>): Promise<T> {
  const session = await getSession()
  if (!session) throw new Error('Keine aktive Anmeldung. Bitte erneut anmelden.')
  try {
    return await read()
  } catch (cause) {
    const message = errorMessage(cause)
    if (/jwt issued at future/i.test(message)) {
      // Serialize recovery waits so simultaneous loads do not each refresh the session.
      // Server-side skew is usually transient; refreshing immediately issues another
      // JWT with a new iat and can prolong the rejection.
      let lastError: unknown = cause
      for (const delay of [1500, 3000, 5000, 7000]) {
        if (!pendingFutureJwtRecovery) {
          pendingFutureJwtRecovery = pause(delay).finally(() => { pendingFutureJwtRecovery = null })
        }
        await pendingFutureJwtRecovery
        try { return await read() } catch (error) {
          lastError = error
          if (!/jwt issued at future/i.test(errorMessage(error))) throw error
        }
      }
      const timing = sessionTiming(session)
      console.warn('Supabase JWT clock diagnostic', {
        issuedAt: timing.issuedAt == null ? null : new Date(timing.issuedAt * 1000).toISOString(),
        browserNow: new Date(timing.now * 1000).toISOString(),
        browserSkewSeconds: timing.issuedAt == null ? null : timing.issuedAt - timing.now,
      })
      throw new Error('Supabase lehnt die Anmeldung wegen einer Zeitabweichung ab (JWT issued at future). Bitte in einigen Sekunden erneut versuchen. Falls der Fehler bleibt, müssen die Serverzeiten geprüft werden.', { cause: lastError })
    }
    if (!/jwt expired|invalid jwt/i.test(message)) throw cause
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) throw error ?? new Error('Anmeldung konnte nicht erneuert werden.')
    return read()
  }
}
