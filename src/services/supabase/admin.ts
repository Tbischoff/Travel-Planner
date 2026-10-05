import { supabase } from './client'

export interface AdminUser {
  id: string
  username: string | null
  email: string | null
  is_admin: boolean
  last_sign_in_at: string | null
}

interface OwnedTrip {
  name: string
}

export class AdminUsersError extends Error {
  status: number
  ownedTrips: OwnedTrip[]

  constructor(message: string, status: number, ownedTrips: OwnedTrip[] = []) {
    super(message)
    this.name = 'AdminUsersError'
    this.status = status
    this.ownedTrips = ownedTrips
  }
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) throw error || new Error('Keine gültige Anmeldung.')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new AdminUsersError(
      typeof result.error === 'string' ? result.error : `HTTP ${response.status}`,
      response.status,
      Array.isArray(result.owned_trips) ? result.owned_trips as OwnedTrip[] : [],
    )
  }
  return result
}

export async function listUsers(): Promise<AdminUser[]> {
  const result = await invokeAdminUsers({ action: 'list_users' })
  return Array.isArray(result.users) ? result.users as AdminUser[] : []
}

export async function inviteUser(username: string, email: string): Promise<void> {
  await invokeAdminUsers({ action: 'invite_user', username, email })
}

export async function deleteUser(userId: string): Promise<void> {
  await invokeAdminUsers({ action: 'delete_user', user_id: userId })
}
