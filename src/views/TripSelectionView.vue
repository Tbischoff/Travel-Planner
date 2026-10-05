<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTripStore } from '../stores/trip'
import type { Trip, TripInput, TripRole } from '../services/supabase/trips'
import { addTripMember, listMemberCandidates, listTripMembers, removeTripMember, setTripMemberRole, type MemberCandidate, type TripMember } from '../services/supabase/members'

const auth = useAuthStore()
const trips = useTripStore()
const router = useRouter()
const message = ref('')
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

const sortedTrips = computed(() => [...trips.trips].sort((a,b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name, 'de')))
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
  try { await trips.load(auth.user.id); message.value = '' } catch (e) { message.value = `Reisen konnten nicht geladen werden: ${errorMessage(e)}` }
}
function openEditor(trip?: Trip): void {
  editing.value = trip ?? null
  form.name = trip?.name ?? ''
  form.destination = trip?.destination ?? ''
  form.startDate = trip?.start_date ?? ''
  form.endDate = trip?.end_date ?? trip?.start_date ?? ''
  editorOpen.value = true
}
function syncEndDate(): void { if (!form.endDate || form.endDate < form.startDate) form.endDate = form.startDate }
async function saveTrip(): Promise<void> {
  if (!auth.user) return
  if (form.endDate < form.startDate) { message.value = 'Das Enddatum darf nicht vor dem Startdatum liegen.'; return }
  busy.value = true
  try {
    const input = { ...form }
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
</script>

<template>
<main class="trips-page"><section class="trips-shell">
<header class="trips-header"><div><p class="auth-card__eyebrow">Travel Planner v3</p><h1>Meine Reisen</h1><p v-if="auth.user?.email">{{ auth.user.email }}</p></div>
<div class="header-actions"><button @click="router.push('/account')" class="secondary-button">Konto</button><button @click="logout" class="secondary-button">Abmelden</button></div></header>
<div class="trips-toolbar"><button @click="openEditor()">+ Neue Reise</button><p v-if="message">{{ message }}</p></div>
<section v-if="trips.loading" class="empty-card">Reisen werden geladen …</section>
<section v-else-if="!sortedTrips.length" class="empty-card">Noch keine Reisen vorhanden.</section>
<section v-else class="trip-grid">
<article v-for="trip in sortedTrips" :key="trip.id" class="trip-card">
<button class="trip-card-main" @click="openTrip(trip)"><strong>{{ trip.name }}</strong><span>{{ trip.destination }}</span><small>{{ dateRange(trip) }}</small><span class="badge">{{ roleLabel(trip.current_user_role) }}</span></button>
<div class="trip-card-actions"><button class="secondary-button" @click="openMembers(trip)">Mitglieder</button><button v-if="trip.current_user_role === 'owner'" class="secondary-button" @click="openEditor(trip)">Bearbeiten</button><button v-if="trip.current_user_role === 'owner'" class="danger-button" @click="deleteTrip(trip)">Löschen</button><button v-else class="danger-button" @click="leave(trip)">Reise verlassen</button></div>
</article></section>
</section>

<Teleport to="body"><div v-if="editorOpen" class="app-modal-backdrop" @click.self="editorOpen=false"><form class="dialog-card" @submit.prevent="saveTrip"><h2>{{ editing ? 'Reise bearbeiten' : 'Neue Reise' }}</h2>
<label>Name<input v-model="form.name" required></label><label>Reiseziel<input v-model="form.destination" required></label><label>Startdatum<input v-model="form.startDate" type="date" required @change="syncEndDate"></label><label>Enddatum<input v-model="form.endDate" type="date" :min="form.startDate" required></label>
<div class="dialog-actions"><button type="button" class="secondary-button" @click="editorOpen=false">Abbrechen</button><button :disabled="busy" type="submit">Speichern</button></div></form></div></Teleport>

<Teleport to="body"><div v-if="membersOpen" class="app-modal-backdrop" @click.self="membersOpen=false"><section class="dialog-card members-card"><div class="dialog-heading"><h2>Mitglieder · {{ membersTrip?.name }}</h2><button class="secondary-button" @click="membersOpen=false">Schließen</button></div>
<form v-if="meIsOwner" class="member-add" @submit.prevent="addMember"><select v-model="selectedCandidate" required><option value="">{{ candidates.length ? 'Benutzer auswählen …' : 'Keine weiteren Benutzer verfügbar' }}</option><option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.username || 'Benutzer' }}</option></select><select v-model="selectedRole"><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button type="submit" :disabled="!selectedCandidate">Hinzufügen</button></form>
<p v-if="membersMessage">{{ membersMessage }}</p><div class="member-list"><article v-for="member in members" :key="member.user_id" class="member-row"><div><strong>{{ member.username || member.email || 'Benutzer' }}</strong><small>{{ roleLabel(member.role) }}<template v-if="member.user_id===auth.user?.id"> · Du</template></small></div><div v-if="meIsOwner && member.role !== 'owner'" class="member-controls"><select :value="member.role" @change="changeRole(member,$event)"><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button class="danger-button" @click="removeMember(member)">Entfernen</button></div></article></div></section></div></Teleport>
</main>
</template>
