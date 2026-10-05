import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './app/App.vue'
import router from './app/router'
import { registerRouterGuards } from './app/guards'
import { onAuthStateChange } from './services/supabase/auth'
import { useAuthStore } from './stores/auth'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

registerRouterGuards(router)

const auth = useAuthStore(pinia)
onAuthStateChange((event, session) => {
  auth.setUser(session?.user ?? null)
  if (event === 'SIGNED_OUT' && router.currentRoute.value.meta.requiresAuth) {
    void router.replace('/login')
  }
  if (event === 'PASSWORD_RECOVERY') {
    void router.replace('/reset-password?type=recovery')
  }
})

app.mount('#app')
