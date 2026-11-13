import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "./env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/**
 * Creates a browser-safe Supabase client using public publishable credentials.
 * This client runs strictly in the browser and respects Row-Level Security (RLS).
 * Memoized as a singleton to avoid redundant connections and auth state listeners.
 */
export function createClient() {
  if (browserClient) return browserClient;

  const env = getPublicEnv();
  
  browserClient = createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );

  return browserClient;
}
