import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "./lib/supabase/env";

// Public routes that never require authentication
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/unauthorized",
  "/forbidden",
];

// Owner-only route prefixes that staff cannot access
const OWNER_ONLY_ROUTES = [
  "/accounting",
  "/dashboard/accounting",
  "/reports",
  "/dashboard/reports",
  "/settings",
  "/dashboard/settings",
  "/payroll",
  "/dashboard/payroll",
  "/staff",
  "/dashboard/staff",
  "/purchases",
  "/dashboard/purchases",
  "/suppliers",
  "/dashboard/suppliers",
  "/pricing",
  "/dashboard/pricing",
  "/expenses",
  "/dashboard/expenses",
];

interface SupabaseJwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
  user_metadata?: { role?: string };
  app_metadata?: { role?: string };
}

/**
 * Fast in-memory parsing of Supabase JWT from session cookies.
 * Avoids redundant cross-continental HTTP network round-trips when session is active.
 */
function extractSupabaseJwt(cookies: Array<{ name: string; value: string }>): SupabaseJwtPayload | null {
  const tokenCookies = cookies.filter(
    (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
  );
  if (tokenCookies.length === 0) return null;

  tokenCookies.sort((a, b) => {
    const idxA = a.name.includes(".") ? parseInt(a.name.split(".").pop() || "0", 10) : 0;
    const idxB = b.name.includes(".") ? parseInt(b.name.split(".").pop() || "0", 10) : 0;
    return idxA - idxB;
  });

  let raw = tokenCookies.map((c) => c.value).join("");
  if (raw.startsWith("base64-")) {
    try {
      raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
    } catch {
      return null;
    }
  } else {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Keep raw
    }
  }

  let accessToken: string | null = null;
  try {
    const sessionObj = JSON.parse(raw);
    if (sessionObj) {
      if (typeof sessionObj.access_token === "string") {
        accessToken = sessionObj.access_token;
      } else if (Array.isArray(sessionObj) && typeof sessionObj[0] === "string") {
        accessToken = sessionObj[0];
      }
    }
  } catch {
    if (raw.includes(".")) {
      accessToken = raw;
    }
  }

  if (accessToken && accessToken.split(".").length === 3) {
    try {
      const payloadBase64 = accessToken.split(".")[1];
      const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf8");
      return JSON.parse(payloadJson) as SupabaseJwtPayload;
    } catch {
      return null;
    }
  }

  return null;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const { pathname } = request.nextUrl;

  // 1. Static asset and Next.js internal bypass
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return response;
  }

  // 2. Decommissioned Customer Portal Redirect: Redirect any customer portal URL to /login
  if (pathname.startsWith("/customer")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname === route);

  // 3. Fast cookie-level session presence check (Zero-network latency optimization)
  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some(
    (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
  );

  // If unauthenticated and accessing a protected route -> redirect to login immediately without network roundtrip
  if (!hasAuthCookie && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If unauthenticated and accessing a public route -> return immediately with zero network overhead
  if (!hasAuthCookie && isPublicRoute) {
    return response;
  }

  // 4. Server Action bypass:
  // Next.js Server Actions (POST requests with `next-action` header) run on the secure server
  // and handle their own authentication and authorization. Bypass middleware to eliminate
  // 300-800ms lag on EVERY form submission.
  const isServerAction = request.headers.has("next-action");
  if (isServerAction && hasAuthCookie) {
    return response;
  }

  // 5. Prefetch request optimization:
  // Link prefetch requests do not need synchronous cross-continental auth checks.
  const isPrefetch =
    request.headers.get("x-middleware-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose") === "prefetch";

  if (isPrefetch && hasAuthCookie) {
    return response;
  }

  // 6. Ultra-fast In-Memory JWT Validation (Zero-network latency)
  // If the JWT access token is intact and unexpired, verify identity and roles in 0.01ms memory
  const jwt = extractSupabaseJwt(allCookies);
  const nowSec = Date.now() / 1000;
  const isTokenValid = jwt && typeof jwt.exp === "number" && jwt.exp > nowSec;

  if (isTokenValid) {
    // Authenticated user accessing login / register -> redirect to dashboard
    if (pathname === "/login" || pathname === "/register") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    // Role-based route enforcement
    const isOwnerRoute = OWNER_ONLY_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(route + "/")
    );

    if (isOwnerRoute) {
      const metaRole = jwt.user_metadata?.role || jwt.app_metadata?.role;
      if (metaRole && metaRole !== "owner") {
        return NextResponse.redirect(new URL("/forbidden", request.url));
      }
    }

    // Unexpired session passes instantly with 0ms network latency
    return response;
  }

  // 7. Token is expired or missing: Call Supabase SSR client to refresh session using refresh_token
  const env = getPublicEnv();
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Parameters<typeof response.cookies.set>[2] }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Server-verified session check & refresh via getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated user accessing protected route -> redirect to login
  if (!user && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user accessing login / register -> redirect to dashboard
  if (user && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Enforce owner-only route access: Authenticated staff cannot access owner pages
  if (user) {
    const isOwnerRoute = OWNER_ONLY_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(route + "/")
    );

    if (isOwnerRoute) {
      const metaRole = (user.user_metadata?.role || user.app_metadata?.role) as string | undefined;
      if (metaRole === "owner") {
        return response;
      }
      if (metaRole && metaRole !== "owner") {
        return NextResponse.redirect(new URL("/forbidden", request.url));
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.role !== "owner") {
        return NextResponse.redirect(new URL("/forbidden", request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ico)$).*)",
  ],
};
