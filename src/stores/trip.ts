import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as tripService from '../services/supabase/trips'
import type { Trip, TripInput } from '../services/supabase/trips'
import { getSession, sessionTiming, waitUntilSessionIsUsable } from '../services/supabase/auth'

const LAST_TRIP_KEY = 'travelPlannerLastTripId'

export const useTripStore = defineStore('trip', () => {
  const trips = ref<Trip[]>([])
  const currentTrip = ref<Trip | null>(null)
  const loading = ref(false)
  const currentRole = computed(() => currentTrip.value?.current_user_role ?? null)
  const canEditContent = computed(() => currentRole.value === 'owner' || currentRole.value === 'editor')
  const isOwner = computed(() => currentRole.value === 'owner')

  async function load(userId: string): Promise<void> {
    loading.value = true
    try {
      const session = await getSession()
      if (session) await waitUntilSessionIsUsable(session)
      try {
        trips.value = await tripService.listTrips(userId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/jwt issued at future/i.test(message)) throw error
        // If PostgREST still reports a future-issued token, use the token's
        // actual iat value to wait the remaining skew instead of blind retries.
        const retrySession = await getSession()
        if (!retrySession) throw error
        const timing = sessionTiming(retrySession)
        if (timing.issuedInFutureBySeconds > 30) {
          throw new Error(`JWT-Zeitabweichung zu groß (${timing.issuedInFutureBySeconds}s). Bitte Gerätezeit prüfen.`)
        }
        if (timing.issuedInFutureBySeconds > 0) {
          await new Promise(resolve => window.setTimeout(resolve, (timing.issuedInFutureBySeconds + 1) * 1000))
        } else {
          await new Promise(resolve => window.setTimeout(resolve, 1500))
        }
        trips.value = await tripService.listTrips(userId)
      }
    } finally { loading.value = false }
  }
  async function create(input: TripInput, userId: string): Promise<void> { await tripService.createTrip(input); await load(userId) }
  async function update(id: string, input: TripInput, userId: string): Promise<void> { await tripService.updateTrip(id, input); await load(userId) }
  async function remove(id: string, userId: string): Promise<void> {
    await tripService.deleteTrip(id)
    if (localStorage.getItem(LAST_TRIP_KEY) === id) localStorage.removeItem(LAST_TRIP_KEY)
    await load(userId)
  }
  async function leave(id: string, userId: string): Promise<void> {
    await tripService.leaveTrip(id)
    if (localStorage.getItem(LAST_TRIP_KEY) === id) localStorage.removeItem(LAST_TRIP_KEY)
    await load(userId)
  }
  function select(trip: Trip): void { currentTrip.value = trip; localStorage.setItem(LAST_TRIP_KEY, trip.id) }
  function clear(): void { currentTrip.value = null }

  return { trips, currentTrip, currentRole, canEditContent, isOwner, loading, load, create, update, remove, leave, select, clear }
})
