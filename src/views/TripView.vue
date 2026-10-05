<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useTripStore } from '../stores/trip'
const trips = useTripStore()
const router = useRouter()
</script>
<template><main class="auth-page"><section class="auth-card"><p class="auth-card__eyebrow">Travel Planner v3</p><h1>{{ trips.currentTrip?.name || 'Reise' }}</h1><p><strong>{{ trips.currentTrip?.destination }}</strong></p><p>Die Reise wurde erfolgreich geöffnet. Orte, Karte und Tagesplanung folgen in den nächsten Migrationsschritten.</p><p v-if="trips.currentRole">Rolle: <span class="badge">{{ trips.currentRole }}</span></p><button @click="router.push('/trips')">Zur Reiseauswahl</button></section></main></template>
