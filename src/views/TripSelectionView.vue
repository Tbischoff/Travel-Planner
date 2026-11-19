<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { supabase } from '../services/supabase/client'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTripStore } from '../stores/trip'
import type { Trip, TripInput, TripRole } from '../services/supabase/trips'
import { geocodeDestination } from '../services/google/maps'
import { addTripMember, listMemberCandidates, listTripMembers, removeTripMember, setTripMemberRole, type MemberCandidate, type TripMember } from '../services/supabase/members'

const auth = useAuthStore()
const trips = useTripStore()
const router = useRouter()
const message = ref('')
const loadFailed = ref(false)
const editorOpen = ref(false)
const editing = ref<Trip | null>(null)
const form = reactive<TripInput>({ name: '', destination: '', startDate: '', endDate: '' })
const membersOpen = ref(false)
const membersTrip = ref<Trip | null>(null)
const members = ref<TripMember[]>([])
const candidates = ref<MemberCandidate[]>([])
const selectedCandidate = ref('')
const selectedRole = ref<'editor' | 'viewer'>('editor')
const membersMessage = ref('')
const busy = ref(false)
const destinationMessage = ref('')

const SORT_KEY = 'travelPlannerTripSortModeV1'
const sortMode = ref<'date' | 'manual'>(localStorage.getItem(SORT_KEY) === 'manual' ? 'manual' : 'date')
const manualIds = ref<string[]>([])
const sortingBusy = ref(false)
const sortedTrips = computed(() => {
  const rows = [...trips.trips]
  if (sortMode.value === 'date') return rows.sort((a,b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name,'de'))
  const positions = new Map(manualIds.value.map((id,index) => [id,index]))
  return rows.sort((a,b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name,'de'))
})
function syncManualOrder() {
  manualIds.value = [...trips.trips].sort((a,b) => (a.sort_position ?? Number.MAX_SAFE_INTEGER) - (b.sort_position ?? Number.MAX_SAFE_INTEGER) || a.start_date.localeCompare(b.start_date)).map(t => t.id)
}
async function persistTripOrder() {
  if (!auth.user || sortingBusy.value) return
  sortingBusy.value = true
  try {
    const rows = manualIds.value.map((trip_id,index) => ({user_id:auth.user!.id,trip_id,sort_position:index,updated_at:new Date().toISOString()}))
    const {error} = await supabase.from('trip_user_preferences').upsert(rows,{onConflict:'user_id,trip_id'})
    if (error) throw error
    trips.trips.forEach(t => { t.sort_position = manualIds.value.indexOf(t.id) })
    message.value = 'Manuelle Reihenfolge gespeichert.'
  } catch(e) {
    message.value = 'Reihenfolge konnte nicht gespeichert werden: ' + errorMessage(e)
    syncManualOrder()
  } finally { sortingBusy.value = false }
}
async function setSortMode(mode: 'date' | 'manual') {
  if (mode === sortMode.value) return
  if (mode === 'manual') {
    syncManualOrder()
    if (trips.trips.some(t => t.sort_position === null)) {
      sortMode.value = 'manual'
      await persistTripOrder()
      if (message.value.startsWith('Reihenfolge konnte')) { sortMode.value = 'date'; return }
    }
  }
  sortMode.value = mode
  localStorage.setItem(SORT_KEY,mode)
}
type TripDrag = {pointerId:number;id:string;startY:number;ghost:HTMLElement;handle:HTMLElement}
let tripDrag: TripDrag | null = null
const draggingTripId = ref('')
function clearTripDrag() {
  if (tripDrag) {
    try { tripDrag.handle.releasePointerCapture(tripDrag.pointerId) } catch {}
    tripDrag.ghost.remove()
  }
  tripDrag = null
  draggingTripId.value = ''
  window.removeEventListener('pointermove', moveTripDrag)
  window.removeEventListener('pointerup', endTripDrag)
  window.removeEventListener('pointercancel', cancelTripDrag)
}
function startTripDrag(event: PointerEvent, id: string) {
  if (sortMode.value !== 'manual' || sortingBusy.value || (event.button !== 0 && event.pointerType === 'mouse')) return
  const handle = event.currentTarget as HTMLElement
  const card = handle.closest('.trip-card') as HTMLElement | null
  if (!card) return
  event.preventDefault()
  clearTripDrag()
  const rect = card.getBoundingClientRect()
  const ghost = card.cloneNode(true) as HTMLElement
  ghost.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:.88;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;box-sizing:border-box;box-shadow:0 12px 32px #0003;background:white;border-radius:12px'
  document.body.appendChild(ghost)
  tripDrag = {pointerId:event.pointerId,id,startY:event.clientY,ghost,handle}
  draggingTripId.value = id
  try { handle.setPointerCapture(event.pointerId) } catch {}
  window.addEventListener('pointermove',moveTripDrag,{passive:false})
  window.addEventListener('pointerup',endTripDrag)
  window.addEventListener('pointercancel',cancelTripDrag)
}
function moveTripDrag(event: PointerEvent) {
  const drag = tripDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  event.preventDefault()
  drag.ghost.style.transform = 'translateY('+(event.clientY-drag.startY)+'px)'
  const targets = [...document.querySelectorAll<HTMLElement>('.trip-card[data-trip-id]')].filter(el => el.dataset.tripId !== drag.id)
  const target = targets.find(el => { const r=el.getBoundingClientRect();return event.clientY >= r.top && event.clientY <= r.bottom })
  if (!target?.dataset.tripId) return
  const ids = [...manualIds.value]
  const old = ids.indexOf(drag.id), next = ids.indexOf(target.dataset.tripId)
  if (old < 0 || next < 0 || old === next) return
  ids.splice(old,1)
  ids.splice(next,0,drag.id)
  manualIds.value = ids
}
function endTripDrag(event: PointerEvent) {
  if (!tripDrag || tripDrag.pointerId !== event.pointerId) return
  const original = trips.trips.slice().sort((a,b)=>(a.sort_position ?? Number.MAX_SAFE_INTEGER)-(b.sort_position ?? Number.MAX_SAFE_INTEGER)||a.start_date.localeCompare(b.start_date)).map(t=>t.id)
  const changed = manualIds.value.some((id,index)=>id!==original[index])
  clearTripDrag()
  if (changed) void persistTripOrder()
}
function cancelTripDrag(event: PointerEvent) {
  if (!tripDrag || tripDrag.pointerId !== event.pointerId) return
  clearTripDrag()
  syncManualOrder()
}
const meIsOwner = computed(() => members.value.find(m => m.user_id === auth.user?.id)?.role === 'owner')
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') return e.message
  return 'Unbekannter Fehler'
}
function roleLabel(role: TripRole | null): string { return role === 'owner' ? 'Besitzer' : role === 'editor' ? 'Editor' : role === 'viewer' ? 'Viewer' : '' }
function dateRange(t: Trip): string { return `${new Date(t.start_date + 'T00:00:00').toLocaleDateString('de-DE')} – ${new Date(t.end_date + 'T00:00:00').toLocaleDateString('de-DE')}` }

async function load(): Promise<void> {
  if (!auth.user) return
  message.value = 'Reisen werden geladen …'
  loadFailed.value = false
  try {
    await trips.load(auth.user.id)
    syncManualOrder()
    message.value = ''
  } catch (e) {
    loadFailed.value = true
    message.value = `Reisen konnten nicht geladen werden: ${errorMessage(e)}`
  }
}
function openEditor(trip?: Trip): void {
  editing.value = trip ?? null
  form.name = trip?.name ?? ''
  form.destination = trip?.destination ?? ''
  form.startDate = trip?.start_date ?? ''
  form.endDate = trip?.end_date ?? trip?.start_date ?? ''
  destinationMessage.value = ''
  editorOpen.value = true
}
function syncEndDate(): void { if (!form.endDate || form.endDate < form.startDate) form.endDate = form.startDate }
async function saveTrip(): Promise<void> {
  if (!auth.user) return
  if (form.endDate < form.startDate) { message.value = 'Das Enddatum darf nicht vor dem Startdatum liegen.'; return }
  busy.value = true
  destinationMessage.value = 'Reiseziel wird geprüft …'
  try {
    const destination = form.destination.trim()
    if (!destination) {
      destinationMessage.value = 'Bitte ein Reiseziel eingeben.'
      return
    }
    try {
      await geocodeDestination(destination)
    } catch {
      destinationMessage.value = 'Das Reiseziel konnte nicht gefunden werden. Bitte Stadt oder Ort genauer angeben.'
      return
    }
    destinationMessage.value = ''
    const input = { ...form, destination }
    if (editing.value) await trips.update(editing.value.id, input, auth.user.id)
    else await trips.create(input, auth.user.id)
    editorOpen.value = false
    message.value = editing.value ? 'Reise wurde aktualisiert.' : 'Reise wurde angelegt.'
  } catch(e) { message.value = `Speichern fehlgeschlagen: ${errorMessage(e)}` } finally { busy.value = false }
}
async function deleteTrip(trip: Trip): Promise<void> {
  if (!auth.user) return
  const confirmation = window.prompt(`„${trip.name}“ wirklich löschen?\n\nGib zum Bestätigen den Reisenamen ein:`)
  if (confirmation === null) return
  if (confirmation.trim() !== trip.name) { window.alert('Der eingegebene Reisename stimmt nicht überein.'); return }
  try { await trips.remove(trip.id, auth.user.id); message.value = 'Reise wurde gelöscht.' } catch(e) { message.value = `Löschen fehlgeschlagen: ${errorMessage(e)}` }
}
async function leave(trip: Trip): Promise<void> {
  if (!auth.user || !window.confirm(`„${trip.name}“ verlassen? Du hast danach keinen Zugriff mehr auf diese Reise.`)) return
  try { await trips.leave(trip.id, auth.user.id); message.value = `Du hast „${trip.name}“ verlassen.` } catch(e) { message.value = `Reise konnte nicht verlassen werden: ${errorMessage(e)}` }
}
function openTrip(trip: Trip): void { trips.select(trip); router.push('/trip') }

async function openMembers(trip: Trip): Promise<void> {
  membersTrip.value = trip; membersOpen.value = true; membersMessage.value = 'Mitglieder werden geladen …'
  await refreshMembers()
}
async function refreshMembers(): Promise<void> {
  if (!membersTrip.value) return
  try {
    members.value = await listTripMembers(membersTrip.value.id)
    if (members.value.find(m => m.user_id === auth.user?.id)?.role === 'owner') {
      const existing = new Set(members.value.map(m => m.user_id))
      candidates.value = (await listMemberCandidates(membersTrip.value.id)).filter(c => !existing.has(c.id))
    } else candidates.value = []
    membersMessage.value = ''
  } catch(e) { membersMessage.value = `Mitglieder konnten nicht geladen werden: ${errorMessage(e)}` }
}
async function addMember(): Promise<void> {
  if (!membersTrip.value || !selectedCandidate.value) return
  try { await addTripMember(membersTrip.value.id, selectedCandidate.value, selectedRole.value); selectedCandidate.value = ''; await refreshMembers() }
  catch(e) { membersMessage.value = `Hinzufügen fehlgeschlagen: ${errorMessage(e)}` }
}
async function changeRole(member: TripMember, event: Event): Promise<void> {
  if (!membersTrip.value) return
  const role = (event.target as HTMLSelectElement).value as 'editor' | 'viewer'
  try { await setTripMemberRole(membersTrip.value.id, member.user_id, role); await refreshMembers() }
  catch(e) { membersMessage.value = `Rolle konnte nicht geändert werden: ${errorMessage(e)}`; await refreshMembers() }
}
async function removeMember(member: TripMember): Promise<void> {
  if (!membersTrip.value || !window.confirm(`${member.username || member.email || 'Mitglied'} aus „${membersTrip.value.name}“ entfernen?`)) return
  try { await removeTripMember(membersTrip.value.id, member.user_id); await refreshMembers() }
  catch(e) { membersMessage.value = `Entfernen fehlgeschlagen: ${errorMessage(e)}` }
}
async function logout(): Promise<void> { trips.clear(); await auth.logout(); await router.replace('/login') }
onMounted(load)
onUnmounted(clearTripDrag)
</script>

<template>
<main class="trips-page"><section class="trips-shell">
<header class="trips-header"><div><p class="auth-card__eyebrow">Travel Planner v3</p><h1>Meine Reisen</h1><p v-if="auth.user?.email">{{ auth.user.email }}</p></div>
<div class="header-actions"><button @click="router.push('/account')" class="secondary-button">Konto</button><button @click="logout" class="secondary-button">Abmelden</button></div></header>
<div class="trips-toolbar"><button @click="openEditor()">+ Neue Reise</button><div class="trip-sort-controls"><button type="button" :aria-pressed="sortMode === 'date'" :class="{ 'trip-sort-active': sortMode === 'date' }" @click="setSortMode('date')">Nach Startdatum</button><button type="button" :aria-pressed="sortMode === 'manual'" :class="{ 'trip-sort-active': sortMode === 'manual' }" @click="setSortMode('manual')">Manuell</button></div><p v-if="message">{{ message }}</p></div>
<p v-if="sortMode === 'manual'" class="trip-sort-hint">Ziehe Reisen am Griff ⋮⋮ in deine persönliche Reihenfolge. Die Änderungen werden automatisch gespeichert.</p>
<section v-if="trips.loading" class="empty-card">Reisen werden geladen …</section>
<section v-else-if="!sortedTrips.length && !loadFailed" class="empty-card">Noch keine Reisen vorhanden.</section>
<section v-else class="trip-grid">
<article v-for="trip in sortedTrips" :key="trip.id" class="trip-card" :data-trip-id="trip.id" :class="{ 'trip-card--dragging': draggingTripId === trip.id }">
<button v-if="sortMode === 'manual'" type="button" class="trip-sort-handle" aria-label="Reise verschieben" :disabled="sortingBusy" @pointerdown="startTripDrag($event,trip.id)">⋮⋮</button>
<button class="trip-card-main" @click="openTrip(trip)"><strong>{{ trip.name }}</strong><span>{{ trip.destination }}</span><small>{{ dateRange(trip) }}</small><span class="badge">{{ roleLabel(trip.current_user_role) }}</span></button>
<div class="trip-card-actions"><button class="secondary-button" @click="openMembers(trip)">Mitglieder</button><button v-if="trip.current_user_role === 'owner'" class="secondary-button" @click="openEditor(trip)">Bearbeiten</button><button v-if="trip.current_user_role === 'owner'" class="danger-button" @click="deleteTrip(trip)">Löschen</button><button v-else class="danger-button" @click="leave(trip)">Reise verlassen</button></div>
</article></section>
</section>

<Teleport to="body"><div v-if="editorOpen" class="app-modal-backdrop" @click.self="editorOpen=false"><form class="dialog-card" @submit.prevent="saveTrip"><h2>{{ editing ? 'Reise bearbeiten' : 'Neue Reise' }}</h2>
<label>Name<input v-model="form.name" required></label><label>Reiseziel<input v-model="form.destination" required></label><p v-if="destinationMessage" class="destination-validation">{{ destinationMessage }}</p><label>Startdatum<input v-model="form.startDate" type="date" required @change="syncEndDate"></label><label>Enddatum<input v-model="form.endDate" type="date" :min="form.startDate" required></label>
<div class="dialog-actions"><button type="button" class="secondary-button" @click="editorOpen=false">Abbrechen</button><button :disabled="busy" type="submit">Speichern</button></div></form></div></Teleport>

<Teleport to="body"><div v-if="membersOpen" class="app-modal-backdrop" @click.self="membersOpen=false"><section class="dialog-card members-card"><div class="dialog-heading"><h2>Mitglieder · {{ membersTrip?.name }}</h2><button class="secondary-button" @click="membersOpen=false">Schließen</button></div>
<form v-if="meIsOwner" class="member-add" @submit.prevent="addMember"><select v-model="selectedCandidate" required><option value="">{{ candidates.length ? 'Benutzer auswählen …' : 'Keine weiteren Benutzer verfügbar' }}</option><option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.username || 'Benutzer' }}</option></select><select v-model="selectedRole"><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button type="submit" :disabled="!selectedCandidate">Hinzufügen</button></form>
<p v-if="membersMessage">{{ membersMessage }}</p><div class="member-list"><article v-for="member in members" :key="member.user_id" class="member-row"><div><strong>{{ member.username || member.email || 'Benutzer' }}</strong><small>{{ roleLabel(member.role) }}<template v-if="member.user_id===auth.user?.id"> · Du</template></small></div><div v-if="meIsOwner && member.role !== 'owner'" class="member-controls"><select :value="member.role" @change="changeRole(member,$event)"><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button class="danger-button" @click="removeMember(member)">Entfernen</button></div></article></div></section></div></Teleport>
</main>
</template>
<style scoped>
.trip-sort-controls{display:flex;gap:6px;flex-wrap:wrap}
.trip-sort-controls button{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:9px;padding:9px 12px;cursor:pointer}
.trip-sort-controls button.trip-sort-active{background:#173d37;color:white;border-color:#173d37}
.trip-sort-hint{margin:4px 0 14px;color:#64748b;font-size:13px}
.trip-card{position:relative}
.trip-sort-handle{position:absolute;z-index:2;top:8px;right:8px;touch-action:none;user-select:none;cursor:grab;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#334155;font-size:19px;line-height:1}
.trip-card--dragging{opacity:.35}
</style>
