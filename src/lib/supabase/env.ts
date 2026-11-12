import { z } from "zod";

/**
 * Public client-safe environment schema
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("Valid Supabase URL required"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "Valid Supabase Publishable Key required"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Server-only privileged environment schema
 */
export const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_URL: z.string().url("Valid Supabase URL required").optional(),
  SUPABASE_SECRET_KEY: z.string().min(20, "Valid Supabase Secret Key required").optional(),
  DATABASE_URL: z.string().min(10, "Valid PostgreSQL DATABASE_URL required").optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Get client-safe public Supabase environment variables
 */
export function getPublicEnv() {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!result.success) {
    // Return placeholder safe defaults if not yet populated to allow building
    return {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "placeholder-anon-key",
      isConfigured: false,
    };
  }

  return {
    ...result.data,
    isConfigured: true,
  };
}

/**
 * Get server-only privileged Supabase environment variables
 * Protected by server boundary
 */
export function getServerEnv() {
  const publicEnv = getPublicEnv();
  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL || publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
  });

  const supabaseUrl =
    parsed.success && parsed.data.SUPABASE_URL
      ? parsed.data.SUPABASE_URL
      : process.env.SUPABASE_URL || publicEnv.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseSecretKey =
    parsed.success && parsed.data.SUPABASE_SECRET_KEY
      ? parsed.data.SUPABASE_SECRET_KEY
      : process.env.SUPABASE_SECRET_KEY || "";

  const databaseUrl =
    parsed.success && parsed.data.DATABASE_URL
      ? parsed.data.DATABASE_URL
      : process.env.DATABASE_URL || "";

  return {
    ...publicEnv,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SECRET_KEY: supabaseSecretKey,
    DATABASE_URL: databaseUrl,
    isServerConfigured: Boolean(process.env.SUPABASE_SECRET_KEY && process.env.DATABASE_URL),
  };
}
