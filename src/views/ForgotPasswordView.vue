<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { requestPasswordReset } from '../services/supabase/auth'

const router = useRouter()
const email = ref('')
const loading = ref(false)
const message = ref('')

async function submit(): Promise<void> {
  loading.value = true
  message.value = 'Reset-Link wird versendet …'
  try {
    await requestPasswordReset(email.value.trim())
    message.value = 'Wenn ein Konto mit dieser E-Mail-Adresse existiert, wurde ein Reset-Link versendet.'
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    message.value = `Reset-Link konnte nicht versendet werden: ${text}`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <form class="auth-card" @submit.prevent="submit">
      <p class="auth-card__eyebrow">Travel Planner v3</p>
      <h1>Passwort zurücksetzen</h1>
      <p>Wir senden dir einen Link, mit dem du ein neues Passwort festlegen kannst.</p>
      <label>
        E-Mail
        <input v-model="email" type="email" autocomplete="email" required>
      </label>
      <button type="submit" :disabled="loading">{{ loading ? 'Wird gesendet …' : 'Reset-Link senden' }}</button>
      <button class="link-button" type="button" @click="router.push('/login')">Zurück zur Anmeldung</button>
      <p v-if="message" class="auth-message" aria-live="polite">{{ message }}</p>
    </form>
  </main>
</template>
