/**
 * AquaTrack ERP — Local Database Safety Guard (Shared ESM module)
 * 
 * Strict Security Mandate:
 * Automated integration tests, load tests, or migration runners are strictly
 * restricted to verified local containers (localhost, 127.0.0.1, [::1], 0.0.0.0).
 */

const APPROVED_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

export function validateDatabaseUrlSafety(url) {
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

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      allowed: false,
      reason: `Malformed database URL: "${trimmed}".`,
    };
  }

  // 1. Strict Protocol Check
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

  // 3. Strict Whitelist Check
  if (!APPROVED_LOCAL_HOSTS.has(hostname)) {
    return {
      allowed: false,
      reason: `Host "${hostname}" is not in the approved local host whitelist (localhost, 127.0.0.1, ::1, 0.0.0.0).`,
    };
  }

  // 4. Port Validation
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

export function assertLocalDatabaseUrl(url, callerContext = "Database Safety Guard") {
  const result = validateDatabaseUrlSafety(url);
  if (!result.allowed) {
    throw new Error(`[FATAL HARD STOP - ${callerContext}] ${result.reason} (Target: "${url}")`);
  }
}
