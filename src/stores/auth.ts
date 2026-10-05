import type { User } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authService from '../services/supabase/auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const initialized = ref(false)
  const loading = ref(false)

  const isAuthenticated = computed(() => Boolean(user.value))

  async function initialize(): Promise<void> {
    const session = await authService.getSession()
    user.value = session?.user ?? null
    initialized.value = true
  }

  async function login(email: string, password: string): Promise<void> {
    loading.value = true
    try {
      user.value = await authService.signIn(email.trim(), password)
    } finally {
      loading.value = false
    }
  }

  async function logout(): Promise<void> {
    loading.value = true
    try {
      await authService.signOut()
      user.value = null
    } finally {
      loading.value = false
    }
  }

  async function setPassword(password: string): Promise<void> {
    user.value = await authService.updatePassword(password)
  }

  function setUser(nextUser: User | null): void {
    user.value = nextUser
  }

  return { user, initialized, loading, isAuthenticated, initialize, login, logout, setPassword, setUser }
})
