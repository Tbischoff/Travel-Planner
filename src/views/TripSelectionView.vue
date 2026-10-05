<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

async function logout(): Promise<void> {
  await auth.logout()
  await router.replace('/login')
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card">
      <p class="auth-card__eyebrow">Travel Planner v3</p>
      <h1>Angemeldet</h1>
      <p>Die Authentifizierung funktioniert. Die Reiseauswahl wird im nächsten Migrationsschritt übernommen.</p>
      <p v-if="auth.user?.email"><strong>{{ auth.user.email }}</strong></p>
      <button type="button" @click="router.push('/account')">Konto & Benutzerverwaltung</button>
      <button type="button" class="link-button" @click="logout">Abmelden</button>
    </section>
  </main>
</template>
