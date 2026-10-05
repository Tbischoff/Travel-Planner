import type { Router } from 'vue-router'
import { useAuthStore } from '../stores/auth'

export function registerRouterGuards(router: Router): void {
  router.beforeEach(async (to) => {
    const auth = useAuthStore()

    if (!auth.initialized) {
      await auth.initialize()
    }

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      return { name: 'login' }
    }

    if (to.meta.guestOnly && auth.isAuthenticated) {
      return { name: 'trips' }
    }

    return true
  })
}
