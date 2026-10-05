import { createRouter, createWebHistory } from 'vue-router'
import AccountView from '../views/AccountView.vue'
import ForgotPasswordView from '../views/ForgotPasswordView.vue'
import LoginView from '../views/LoginView.vue'
import ResetPasswordView from '../views/ResetPasswordView.vue'
import TripSelectionView from '../views/TripSelectionView.vue'
import TripView from '../views/TripView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/trips' },
    { path: '/login', name: 'login', component: LoginView, meta: { guestOnly: true } },
    { path: '/forgot-password', name: 'forgot-password', component: ForgotPasswordView, meta: { guestOnly: true } },
    { path: '/reset-password', name: 'reset-password', component: ResetPasswordView },
    { path: '/trips', name: 'trips', component: TripSelectionView, meta: { requiresAuth: true } },
    { path: '/trip', name: 'trip', component: TripView, meta: { requiresAuth: true } },
    { path: '/account', name: 'account', component: AccountView, meta: { requiresAuth: true } },
  ],
})

export default router
