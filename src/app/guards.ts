import type { Router } from 'vue-router'

export function registerRouterGuards(router: Router): void {
  void router
  // Authentication and trip guards are added during the auth/trips migration.
}
