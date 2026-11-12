<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTripStore } from '../stores/trip'

const trips = useTripStore()
const router = useRouter()
type TripTab = 'today' | 'plan' | 'places' | 'tools'
const activeTab = ref<TripTab>('today')
const tabs: { id: TripTab; label: string; icon: string; description: string }[] = [
  { id: 'today', label: 'Heute', icon: '☀️', description: 'Die Tagesansicht wird in einem folgenden Migrationsschritt eingebunden.' },
  { id: 'plan', label: 'Plan', icon: '🗓️', description: 'Die Tagesplanung wird in einem folgenden Migrationsschritt eingebunden.' },
  { id: 'places', label: 'Orte', icon: '📍', description: 'Die Ortsliste und Karte werden in einem folgenden Migrationsschritt eingebunden.' },
  { id: 'tools', label: 'Werkzeuge', icon: '⚙️', description: 'Die Werkzeuge aus v2 werden anschließend schrittweise übernommen.' },
]
</script>

<template>
  <main class="v3-trip">
    <header class="v3-trip__header">
      <div>
        <p class="v3-trip__eyebrow">Travel Planner v3 · Migration</p>
        <h1>{{ trips.currentTrip?.name || 'Reise' }}</h1>
        <p>{{ trips.currentTrip?.destination }}</p>
      </div>
      <button type="button" class="v3-trip__back" @click="router.push('/trips')">Reiseauswahl</button>
    </header>
    <section class="v3-trip__content" aria-live="polite">
      <h2>{{ tabs.find(tab => tab.id === activeTab)?.label }}</h2>
      <p>{{ tabs.find(tab => tab.id === activeTab)?.description }}</p>
      <small v-if="trips.currentRole">Rolle: {{ trips.currentRole }}</small>
    </section>
    <nav class="v3-trip__nav" aria-label="Reisebereiche">
      <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ 'is-active': activeTab === tab.id }" :aria-current="activeTab === tab.id ? 'page' : undefined" @click="activeTab = tab.id">
        <span aria-hidden="true">{{ tab.icon }}</span><span>{{ tab.label }}</span>
      </button>
    </nav>
  </main>
</template>

<style scoped>
.v3-trip{min-height:100dvh;background:#f5f8f7;color:#234b46;padding:20px 20px 100px}
.v3-trip__header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;max-width:1050px;margin:0 auto 20px}
.v3-trip__header h1{margin:5px 0;font-size:clamp(1.4rem,4vw,2rem)}
.v3-trip__header p{margin:0}
.v3-trip__eyebrow{font-size:.8rem;font-weight:700}
.v3-trip__back{border:1px solid #b8d3cf;border-radius:12px;padding:10px;background:white;color:inherit;cursor:pointer}
.v3-trip__content{max-width:1050px;margin:0 auto;background:white;border:1px solid #d6e4e1;border-radius:18px;padding:24px}
.v3-trip__content h2{margin:0 0 12px}
.v3-trip__content p{line-height:1.5}
.v3-trip__nav{position:fixed;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:8px 8px max(8px,env(safe-area-inset-bottom));background:#fff;box-shadow:0 -4px 20px #123c3520;z-index:20}
.v3-trip__nav button{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;border:0;border-radius:14px;background:transparent;color:#506762;padding:10px 3px;font:inherit;font-size:.82rem;cursor:pointer}
.v3-trip__nav button span:first-child{font-size:1.4rem}
.v3-trip__nav button.is-active{background:#e6f2ef;color:#245e55;font-weight:700}
@media(max-width:480px){.v3-trip__header{flex-direction:column}.v3-trip__back{align-self:flex-start}}
</style>
