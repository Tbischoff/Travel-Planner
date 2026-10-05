<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { detectAuthFlow } from '../services/supabase/auth'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const flow = detectAuthFlow()
const password = ref('')
const repeat = ref('')
const loading = ref(false)
const message = ref('')
const isInvite = computed(() => flow === 'invite')

async function submit(): Promise<void> {
  if (password.value.length < 8) {
    message.value = 'Das Passwort muss mindestens 8 Zeichen lang sein.'
    return
  }
  if (password.value !== repeat.value) {
    message.value = 'Die beiden Passwörter stimmen nicht überein.'
    return
  }
  loading.value = true
  message.value = ''
  try {
    await auth.setPassword(password.value)
    await router.replace('/trips')
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    message.value = `Passwort konnte nicht gespeichert werden: ${text}`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <form class="auth-card" @submit.prevent="submit">
      <p class="auth-card__eyebrow">Travel Planner v3</p>
      <h1>{{ isInvite ? 'Konto einrichten' : 'Neues Passwort festlegen' }}</h1>
      <p>{{ isInvite ? 'Willkommen beim Travel Planner! Lege jetzt dein persönliches Passwort fest.' : 'Lege jetzt ein neues Passwort für dein Travel-Planner-Konto fest.' }}</p>
      <label>
        Neues Passwort
        <input v-model="password" type="password" autocomplete="new-password" minlength="8" required>
      </label>
      <label>
        Passwort wiederholen
        <input v-model="repeat" type="password" autocomplete="new-password" minlength="8" required>
      </label>
      <button type="submit" :disabled="loading">{{ loading ? 'Passwort wird gespeichert …' : (isInvite ? 'Konto einrichten' : 'Passwort ändern') }}</button>
      <p v-if="message" class="auth-message" role="alert">{{ message }}</p>
    </form>
  </main>
</template>
