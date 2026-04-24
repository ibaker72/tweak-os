import { createClient } from "@supabase/supabase-js";

// Module-level singleton — safe in Next.js serverless (one instance per worker).
// Uses the service role key so it bypasses RLS.
// NEVER import this in client components or expose it to the browser.
let _client: ReturnType<typeof createClient> | null = null;

export function createServiceClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _client;
}
