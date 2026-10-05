<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const message = ref('')

async function submit(): Promise<void> {
  message.value = ''
  try {
    await auth.login(email.value, password.value)
    await router.replace('/trips')
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    message.value = text === 'Invalid login credentials'
      ? 'E-Mail oder Passwort ist nicht korrekt.'
      : `Anmeldung fehlgeschlagen: ${text}`
  }
}
</script>

<template>
  <main class="auth-page">
    <form class="auth-card" @submit.prevent="submit">
      <p class="auth-card__eyebrow">Travel Planner v3</p>
      <h1>Anmelden</h1>
      <label>
        E-Mail
        <input v-model="email" type="email" autocomplete="email" required>
      </label>
      <label>
        Passwort
        <input v-model="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit" :disabled="auth.loading">
        {{ auth.loading ? 'Anmeldung läuft …' : 'Anmelden' }}
      </button>
      <button class="link-button" type="button" @click="router.push('/forgot-password')">
        Passwort vergessen?
      </button>
      <p v-if="message" class="auth-message" role="alert">{{ message }}</p>
    </form>
  </main>
</template>
