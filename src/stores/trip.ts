import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as tripService from '../services/supabase/trips'
import type { Trip, TripInput } from '../services/supabase/trips'

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
      let lastError: unknown = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          trips.value = await tripService.listTrips(userId)
          lastError = null
          break
        } catch (error) {
          lastError = error
          const message = error instanceof Error ? error.message : String(error)
          if (!/jwt issued at future/i.test(message) || attempt === 3) throw error
          // Supabase can briefly reject a freshly issued token while the auth
          // and database clocks converge. Refreshing immediately creates
          // another equally new token, so wait and retry the same session.
          await new Promise(resolve => window.setTimeout(resolve, 1000 * (attempt + 1)))
        }
      }
      if (lastError) throw lastError
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
