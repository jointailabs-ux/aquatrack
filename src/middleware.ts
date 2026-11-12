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

  // 3. Initialize Supabase SSR client for real session checking
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

  // 4. Server-verified session check via getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname === route);

  // 5. Unauthenticated user accessing protected route -> redirect to login
  if (!user && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 6. Authenticated user accessing login / register -> redirect to dashboard
  if (user && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // 7. Enforce owner-only route access: Authenticated staff cannot access owner pages
  if (user) {
    const isOwnerRoute = OWNER_ONLY_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(route + "/")
    );

    if (isOwnerRoute) {
      // Check user metadata first to avoid redundant database calls
      const metaRole = (user.user_metadata?.role || user.app_metadata?.role) as string | undefined;
      if (metaRole === "owner") {
        return response;
      }
      if (metaRole && metaRole !== "owner") {
        return NextResponse.redirect(new URL("/forbidden", request.url));
      }

      // Bypass extra database roundtrip on prefetch requests to keep page transitions fast
      const isPrefetch =
        request.headers.get("x-middleware-prefetch") === "1" ||
        request.headers.get("purpose") === "prefetch";

      if (!isPrefetch) {
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
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
