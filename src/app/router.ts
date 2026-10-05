import { createRouter, createWebHistory } from 'vue-router'
import FoundationView from '../views/FoundationView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'foundation',
      component: FoundationView,
    },
  ],
})

export default router
