import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase-Konfiguration fehlt. VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.')
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey)
