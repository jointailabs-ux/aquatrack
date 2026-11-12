"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Droplets, Lock, Mail, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/dashboard";
  const { addToast } = useToast();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");

    if (!email || !password) {
      setErrorMessage("Please enter both email and password.");
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        setErrorMessage(error?.message || "Invalid email or password.");
        setIsLoading(false);
        return;
      }

      // Verify active user profile from database
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active, full_name, can_pos, can_warehouse, can_manage_customers, can_manage_orders")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setErrorMessage("Account profile not found. Please contact the business owner.");
        setIsLoading(false);
        return;
      }

      if (!profile.is_active) {
        await supabase.auth.signOut();
        setErrorMessage("This account has been deactivated. Please contact the business owner.");
        setIsLoading(false);
        return;
      }

      addToast({
        type: "success",
        title: "Signed In",
        message: `Welcome back, ${profile.full_name || "User"}!`,
      });

      // Role and permission-aware routing
      if (profile.role === "owner") {
        router.push(redirectPath);
      } else {
        // Staff route routing: If staff member only has mobile delivery duties, route to /driver
        const hasAdminPerms =
          profile.can_pos ||
          profile.can_warehouse ||
          profile.can_manage_customers ||
          profile.can_manage_orders;

        if (redirectPath && redirectPath !== "/dashboard") {
          router.push(redirectPath);
        } else if (hasAdminPerms) {
          router.push("/dashboard");
        } else {
          router.push("/driver");
        }
      }
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected login error occurred.";
      setErrorMessage(msg);
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-primary items-center justify-center text-primary-foreground shadow-sm">
            <Droplets className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            AquaTrack <span className="text-primary font-normal">ERP</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Sign in with your verified staff or owner credentials
          </p>
        </div>

        <Card className="border-border shadow-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">Account Sign In</CardTitle>
            <CardDescription>
              Enter your registered business email and password
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {errorMessage && (
                <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="name@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-9 text-xs"
                    autoComplete="email"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Password</label>
                  <Link
                    href="/forgot-password"
                    className="text-[11px] text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pl-9 text-xs"
                    autoComplete="current-password"
                    disabled={isLoading}
                  />
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full text-xs font-semibold"
                disabled={isLoading}
              >
                {isLoading ? "Verifying..." : "Sign In to Workspace"}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          AquaTrack ERP &bull; Single-Location Operations Platform &bull; Secure Supabase Authentication
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-xs text-muted-foreground">
          Loading workspace sign in...
        </div>
      }
    >
      <LoginForm />
    </React.Suspense>
  );
}
