import { createClient } from "@supabase/supabase-js"

// Service role client — only used server-side in scraper/notifications
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser
// Lazy singleton so build-time import doesn't fail when env vars aren't set
let _supabaseAdmin: ReturnType<typeof createClient> | null = null

export function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _supabaseAdmin
}
