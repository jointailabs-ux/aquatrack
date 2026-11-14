import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind classes with clsx conflict resolution
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format currency values in INR or configured ISO code
 */
export function formatCurrency(amount: number, currency: string = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format dates with localized string
 */
export function formatDate(date: string | Date): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * Format timestamps with time
 */
export function formatDateTime(date: string | Date): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Cleanly extracts human-readable error messages from Zod errors, Postgres exceptions, or API responses
 */
export function formatErrorMessage(err: unknown, fallback: string = "An unexpected error occurred."): string {
  if (!err) return fallback;

  let raw = "";
  if (typeof err === "string") {
    raw = err.trim();
  } else if (err instanceof Error) {
    raw = err.message.trim();
  } else if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") {
      raw = obj.message.trim();
    } else if (typeof obj.error === "string") {
      raw = obj.error.trim();
    }
  }

  if (!raw) return fallback;

  // Check if raw string is a stringified Zod issues array or object
  if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const messages = parsed
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              return obj.message ? String(obj.message) : "";
            }
            return String(item);
          })
          .filter(Boolean);
        if (messages.length > 0) return messages.join(". ");
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (obj.message) return String(obj.message);
        if (obj.error) return String(obj.error);
      }
    } catch {
      // not valid JSON, proceed to text formatting
    }
  }

  // Humanize common Postgres & Supabase error patterns
  if (raw.includes("duplicate key value violates unique constraint")) {
    return "A record with this information already exists. Please check for duplicates.";
  }
  if (raw.includes("violates foreign key constraint")) {
    return "Referenced record was not found or has been removed.";
  }
  if (raw.includes("violates check constraint")) {
    return "The entered value violates database constraints. Please check all fields.";
  }
  if (raw.includes("Direct updates to customer financial balances")) {
    return "Direct customer financial updates are prohibited. Please complete via order or payment.";
  }
  if (raw.includes("JWT expired") || raw.includes("token is expired")) {
    return "Your session has expired. Please log in again.";
  }

  return raw;
}
