<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { updatePassword } from '../services/supabase/auth'
import { getCurrentProfile, isAppAdmin, updateUsername } from '../services/supabase/profiles'
import { AdminUsersError, deleteUser, inviteUser, listUsers, type AdminUser } from '../services/supabase/admin'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const profileMessage = ref('')
const newPassword = ref('')
const repeatPassword = ref('')
const passwordMessage = ref('')
const admin = ref(false)
const users = ref<AdminUser[]>([])
const sortedUsers = computed(() => [...users.value].sort((a, b) => {
  if (a.id === auth.user?.id) return -1
  if (b.id === auth.user?.id) return 1
  const aName = (a.username || a.email || '').trim()
  const bName = (b.username || b.email || '').trim()
  return aName.localeCompare(bName, 'de', { sensitivity: 'base' })
}))
const adminMessage = ref('')
const inviteUsername = ref('')
const inviteEmail = ref('')
const busy = ref(false)

async function loadAccount(): Promise<void> {
  if (!auth.user) return
  busy.value = true
  profileMessage.value = ''
  try {
    const profile = await getCurrentProfile(auth.user.id)
    username.value = profile.username || ''
  } catch (error) {
    profileMessage.value = `Profil konnte nicht geladen werden: ${messageOf(error)}`
  }

  try {
    admin.value = await isAppAdmin()
    if (admin.value) await loadUsers()
  } catch (error) {
    admin.value = false
    adminMessage.value = `Adminstatus konnte nicht geladen werden: ${messageOf(error)}`
    if (!profileMessage.value) profileMessage.value = adminMessage.value
  } finally {
    busy.value = false
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  if (typeof error === 'string') return error
  return 'Unbekannter Fehler'
}

async function saveProfile(): Promise<void> {
  if (!auth.user) return
  const value = username.value.trim()
  if (value.length < 2 || value.length > 50) {
    profileMessage.value = 'Der Benutzername muss zwischen 2 und 50 Zeichen lang sein.'
    return
  }
  busy.value = true
  profileMessage.value = 'Benutzername wird gespeichert …'
  try {
    await updateUsername(auth.user.id, value)
    username.value = value
    profileMessage.value = 'Benutzername wurde gespeichert.'
  } catch (error) {
    profileMessage.value = `Speichern fehlgeschlagen: ${messageOf(error)}`
  } finally {
    busy.value = false
  }
}

async function changePassword(): Promise<void> {
  if (newPassword.value.length < 8) {
    passwordMessage.value = 'Das Passwort muss mindestens 8 Zeichen lang sein.'
    return
  }
  if (newPassword.value !== repeatPassword.value) {
    passwordMessage.value = 'Die beiden Passwörter stimmen nicht überein.'
    return
  }
  busy.value = true
  passwordMessage.value = 'Passwort wird geändert …'
  try {
    await updatePassword(newPassword.value)
    newPassword.value = ''
    repeatPassword.value = ''
    passwordMessage.value = 'Passwort wurde erfolgreich geändert.'
  } catch (error) {
    passwordMessage.value = `Passwort konnte nicht geändert werden: ${messageOf(error)}`
  } finally {
    busy.value = false
  }
}

async function loadUsers(): Promise<void> {
  adminMessage.value = 'Benutzer werden geladen …'
  try {
    users.value = await listUsers()
    adminMessage.value = ''
  } catch (error) {
    adminMessage.value = `Benutzer konnten nicht geladen werden: ${messageOf(error)}`
  }
}

async function sendInvite(): Promise<void> {
  busy.value = true
  adminMessage.value = 'Einladung wird versendet …'
  try {
    await inviteUser(inviteUsername.value.trim(), inviteEmail.value.trim())
    inviteUsername.value = ''
    inviteEmail.value = ''
    adminMessage.value = 'Einladung wurde versendet.'
    await loadUsers()
  } catch (error) {
    adminMessage.value = messageOf(error) === 'email rate limit exceeded'
      ? 'Das E-Mail-Limit von Supabase ist aktuell erreicht. Bitte später erneut versuchen.'
      : `Einladung fehlgeschlagen: ${messageOf(error)}`
  } finally {
    busy.value = false
  }
}

async function removeUser(item: AdminUser): Promise<void> {
  const label = item.username || item.email || 'diesen Benutzer'
  if (!window.confirm(`${label} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return
  adminMessage.value = `${label} wird gelöscht …`
  try {
    await deleteUser(item.id)
    adminMessage.value = 'Benutzer wurde gelöscht.'
    await loadUsers()
  } catch (error) {
    if (error instanceof AdminUsersError && error.status === 409 && error.ownedTrips.length) {
      adminMessage.value = `Löschen nicht möglich. Der Benutzer ist noch Eigentümer folgender Reise(n): ${error.ownedTrips.map(trip => trip.name).join(', ')}.`
    } else {
      adminMessage.value = `Löschen fehlgeschlagen: ${messageOf(error)}`
    }
  }
}

onMounted(loadAccount)
</script>

<template>
  <main class="account-page">
    <section class="account-shell">
      <header class="account-header">
        <div>
          <p class="auth-card__eyebrow">Travel Planner v3</p>
          <h1>Konto</h1>
          <p>{{ auth.user?.email }}</p>
        </div>
        <button type="button" class="secondary-button" @click="router.push('/trips')">Zurück</button>
      </header>

      <section class="account-section">
        <h2>Profil</h2>
        <form class="account-form" @submit.prevent="saveProfile">
          <label>Benutzername <input v-model="username" autocomplete="username"></label>
          <button type="submit" :disabled="busy">Benutzername speichern</button>
          <p v-if="profileMessage" class="auth-message">{{ profileMessage }}</p>
        </form>
      </section>

      <section class="account-section">
        <h2>Passwort ändern</h2>
        <form class="account-form" @submit.prevent="changePassword">
          <label>Neues Passwort <input v-model="newPassword" type="password" autocomplete="new-password"></label>
          <label>Passwort wiederholen <input v-model="repeatPassword" type="password" autocomplete="new-password"></label>
          <button type="submit" :disabled="busy">Passwort ändern</button>
          <p v-if="passwordMessage" class="auth-message">{{ passwordMessage }}</p>
        </form>
      </section>

      <section v-if="admin" class="account-section">
        <h2>Benutzerverwaltung</h2>
        <form class="admin-invite" @submit.prevent="sendInvite">
          <label>Benutzername <input v-model="inviteUsername" required></label>
          <label>E-Mail <input v-model="inviteEmail" type="email" required></label>
          <button type="submit" :disabled="busy">Benutzer einladen</button>
        </form>
        <p v-if="adminMessage" class="auth-message">{{ adminMessage }}</p>
        <div class="admin-users">
          <article v-for="item in sortedUsers" :key="item.id" class="admin-user">
            <div>
              <strong>{{ item.username || 'Ohne Benutzername' }}</strong>
              <span v-if="item.is_admin" class="badge">Admin</span>
              <small>{{ item.email || 'Keine E-Mail' }}</small>
              <small v-if="item.last_sign_in_at">Letzte Anmeldung: {{ new Date(item.last_sign_in_at).toLocaleString('de-DE') }}</small>
            </div>
            <span v-if="item.id === auth.user?.id" class="badge">Du</span>
            <button v-else type="button" class="danger-button" @click="removeUser(item)">Löschen</button>
          </article>
        </div>
      </section>
    </section>
  </main>
</template>
