/**
 * AquaTrack ERP — Local Database Safety Guard
 * 
 * Strict Security Mandate:
 * Under no circumstances may integration tests, load tests, or automated seeders
 * connect to remote or production Supabase instances (e.g. *.supabase.co).
 * 
 * Only explicitly approved local development hostnames are permitted.
 */

export interface DatabaseUrlSafetyResult {
  allowed: boolean;
  reason?: string;
  normalizedUrl?: string;
}

const APPROVED_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

/**
 * Validates whether a target database / Supabase URL is an approved local instance.
 * Rejects all remote hosts, cloud providers, and misleading hostnames.
 */
export function validateDatabaseUrlSafety(url: unknown): DatabaseUrlSafetyResult {
  if (!url || typeof url !== "string") {
    return {
      allowed: false,
      reason: "Database URL must be a non-empty string.",
    };
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return {
      allowed: false,
      reason: "Database URL is empty.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      allowed: false,
      reason: `Malformed database URL: "${trimmed}".`,
    };
  }

  // 1. Strict Protocol Check (Only http: and https: allowed)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      allowed: false,
      reason: `Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted for local instances.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Reject remote Supabase instances and cloud providers
  if (
    hostname.endsWith(".supabase.co") ||
    hostname.endsWith(".supabase.in") ||
    hostname.endsWith(".supabase.net") ||
    hostname.includes("supabase.co")
  ) {
    return {
      allowed: false,
      reason: `Remote Supabase instance rejected ("${hostname}"). Automated integration tests are strictly restricted to local container instances.`,
    };
  }

  // 3. Strict Whitelist Check (Prevents subdomains like localhost.attacker.com or fake-localhost)
  if (!APPROVED_LOCAL_HOSTS.has(hostname)) {
    return {
      allowed: false,
      reason: `Host "${hostname}" is not in the approved local host whitelist (localhost, 127.0.0.1, ::1, 0.0.0.0).`,
    };
  }

  // 4. Port Validation (If port is provided, must be a valid integer between 1 and 65535)
  if (parsed.port) {
    const portNum = parseInt(parsed.port, 10);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535 || String(portNum) !== parsed.port) {
      return {
        allowed: false,
        reason: `Invalid TCP port "${parsed.port}". Port must be an integer between 1 and 65535.`,
      };
    }
  }

  return {
    allowed: true,
    normalizedUrl: parsed.origin,
  };
}

/**
 * Throws an explicit fatal error if the target URL fails local safety validation.
 */
export function assertLocalDatabaseUrl(url: unknown, callerContext = "Database Safety Guard"): void {
  const result = validateDatabaseUrlSafety(url);
  if (!result.allowed) {
    throw new Error(`[FATAL HARD STOP - ${callerContext}] ${result.reason} (Target: "${url}")`);
  }
}
