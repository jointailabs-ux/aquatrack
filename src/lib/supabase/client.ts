import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "./env";

/**
 * Creates a browser-safe Supabase client using public publishable credentials.
 * This client runs strictly in the browser and respects Row-Level Security (RLS).
 */
export function createClient() {
  const env = getPublicEnv();
  
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
