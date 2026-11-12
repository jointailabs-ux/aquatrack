import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getServerEnv } from "./env";

/**
 * Creates a server-side Supabase client for Server Components, Server Actions,
 * and Route Handlers, binding session cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getServerEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            );
          } catch {
            // Can happen in Server Components rendering phase (read-only cookie context)
          }
        },
      },
    }
  );
}

/**
 * Creates a privileged administrative Supabase client using the service role key.
 * Strictly server-only. Never expose to client components or public API responses.
 */
export function createAdminClient() {
  const env = getServerEnv();

  if (!env.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is not configured on the server.");
  }

  return createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );
}
