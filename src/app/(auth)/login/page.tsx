"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Droplets, Lock, Mail, AlertCircle, Truck, ShieldCheck, Key, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { getActiveStaffListForLogin, authenticateStaffWithPin } from "@/modules/staff/staff.service";

interface ActiveStaffOption {
  id: string;
  full_name: string;
  phone: string;
  avatar_url?: string | null;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect");
  const { addToast } = useToast();

  const [loginMode, setLoginMode] = React.useState<"admin" | "staff">("admin");

  // Admin form state
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Staff PIN form state
  const [activeStaffList, setActiveStaffList] = React.useState<ActiveStaffOption[]>([]);
  const [selectedStaffId, setSelectedStaffId] = React.useState<string>("");
  const [staffPin, setStaffPin] = React.useState<string>("");
  const [isLoadingStaffList, setIsLoadingStaffList] = React.useState(false);

  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");

  // Pre-load active staff list immediately on page mount so Staff tab is instant
  React.useEffect(() => {
    let isMounted = true;
    setIsLoadingStaffList(true);
    getActiveStaffListForLogin().then((res) => {
      if (!isMounted) return;
      setIsLoadingStaffList(false);
      if (res.success && res.data) {
        setActiveStaffList(res.data);
        if (res.data.length > 0) {
          setSelectedStaffId((prev) => prev || res.data![0].id);
        }
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Admin Login Handler
  async function handleAdminSubmit(e: React.FormEvent) {
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

      // Fast check from metadata or single query
      const userMeta = data.user.user_metadata;
      let userRole = userMeta?.role || "owner";
      let fullName = userMeta?.full_name || "Admin";

      // Verify active user profile from database in background/parallel
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active, full_name")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profile) {
        if (!profile.is_active) {
          await supabase.auth.signOut();
          setErrorMessage("This account has been deactivated. Please contact the business owner.");
          setIsLoading(false);
          return;
        }
        userRole = profile.role || userRole;
        fullName = profile.full_name || fullName;
      }

      addToast({
        type: "success",
        title: "Signed In",
        message: `Welcome back, ${fullName}!`,
      });

      const destination = userRole === "staff" ? "/staff-portal" : (redirectPath || "/dashboard");
      window.location.href = destination;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected login error occurred.";
      setErrorMessage(msg);
      setIsLoading(false);
    }
  }

  // Staff PIN Login Handler
  async function handleStaffPinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");

    if (!selectedStaffId) {
      setErrorMessage("Please choose your staff name.");
      setIsLoading(false);
      return;
    }

    if (!staffPin || staffPin.length !== 6) {
      setErrorMessage("Please enter your 6-digit staff PIN.");
      setIsLoading(false);
      return;
    }

    try {
      const authRes = await authenticateStaffWithPin(selectedStaffId, staffPin.trim());
      if (!authRes.success || !authRes.data) {
        setErrorMessage(authRes.error || "Incorrect 6-digit PIN. Please try again.");
        setIsLoading(false);
        return;
      }

      const { email: staffEmail, password: staffPassword, staffName } = authRes.data;

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: staffEmail,
        password: staffPassword,
      });

      if (signInError) {
        setErrorMessage(signInError.message || "Failed to sign in staff session.");
        setIsLoading(false);
        return;
      }

      addToast({
        type: "success",
        title: "Welcome! / স্বাগতম",
        message: `Signed in as ${staffName}. Loading your delivery sheet...`,
      });

      window.location.href = "/staff-portal";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Staff login failed.";
      setErrorMessage(msg);
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-blue-600 items-center justify-center text-white shadow-md shadow-sky-500/25">
            <Droplets className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">
            AquaTrack <span className="text-sky-500 font-bold">ERP</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Water Distribution Management & Fleet Route Delivery Platform
          </p>
        </div>

        {/* Dual Mode Switcher Tabs */}
        <div className="grid grid-cols-2 p-1 rounded-2xl bg-muted border border-border shadow-xs">
          <button
            type="button"
            onClick={() => {
              setLoginMode("admin");
              setErrorMessage("");
            }}
            className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              loginMode === "admin"
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-sky-500" />
            <span>Admin Login (অ্যাডমিন)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setLoginMode("staff");
              setErrorMessage("");
            }}
            className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              loginMode === "staff"
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Truck className="h-4 w-4 text-emerald-500" />
            <span>Staff Login (স্টাফ লগইন)</span>
          </button>
        </div>

        <Card className="border-border shadow-lg overflow-hidden">
          {loginMode === "admin" ? (
            /* ============================================================ */
            /* 1. ADMIN LOGIN FORM                                          */
            /* ============================================================ */
            <div>
              <CardHeader className="p-5 pb-3 space-y-1">
                <CardTitle className="text-base font-black flex items-center gap-2 text-foreground">
                  <ShieldCheck className="h-5 w-5 text-sky-500" />
                  <span>Admin & Manager Sign In</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Enter your registered business administrator email & password
                </CardDescription>
              </CardHeader>

              <form onSubmit={handleAdminSubmit}>
                <CardContent className="p-5 pt-1 space-y-3.5">
                  {errorMessage && (
                    <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="admin@aquatrack.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="pl-9 text-xs"
                        autoComplete="email"
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-foreground">Password</label>
                      <Link
                        href="/forgot-password"
                        className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline font-medium"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
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

                <CardFooter className="p-5 pt-2 flex flex-col gap-2.5">
                  <Button
                    type="submit"
                    className="w-full text-xs font-black bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white shadow-xs"
                    disabled={isLoading}
                  >
                    {isLoading ? "Signing in..." : "Sign In to Admin ERP"}
                  </Button>
                </CardFooter>
              </form>
            </div>
          ) : (
            /* ============================================================ */
            /* 2. STAFF PIN LOGIN FORM                                      */
            /* ============================================================ */
            <div>
              <CardHeader className="p-5 pb-3 space-y-1">
                <CardTitle className="text-base font-black flex items-center gap-2 text-foreground">
                  <Truck className="h-5 w-5 text-emerald-500" />
                  <span>Staff & Driver PIN Login (স্টাফ লগইন)</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Choose your staff name and enter your 6-digit assigned PIN
                </CardDescription>
              </CardHeader>

              <form onSubmit={handleStaffPinSubmit}>
                <CardContent className="p-5 pt-1 space-y-4">
                  {errorMessage && (
                    <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {/* 1. Staff Name Picker */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                      <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Select Your Name (আপনার নাম বাছুন) *</span>
                    </label>

                    {isLoadingStaffList ? (
                      <div className="p-3 rounded-xl border border-border text-center text-xs text-muted-foreground">
                        Loading active staff list...
                      </div>
                    ) : activeStaffList.length === 0 ? (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                        No staff accounts provisioned yet. Please ask the administrator to create a staff account with a 6-digit PIN.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Visual Staff Radio Chips */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {activeStaffList.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setSelectedStaffId(s.id)}
                              className={`p-3 rounded-xl border-2 text-left transition-all active:scale-95 cursor-pointer flex items-center gap-2.5 ${
                                selectedStaffId === s.id
                                  ? "bg-emerald-500/10 border-emerald-500 shadow-sm ring-2 ring-emerald-500/20"
                                  : "bg-muted/40 border-border hover:border-emerald-300 dark:hover:border-slate-700"
                              }`}
                            >
                              <div className="h-8 w-8 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-black text-xs flex items-center justify-center shrink-0">
                                {s.full_name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-xs text-foreground truncate">{s.full_name}</div>
                                <div className="text-[10px] text-muted-foreground font-mono">{s.phone}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. 6-Digit PIN Input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                        <Key className="h-3.5 w-3.5 text-amber-500" />
                        <span>6-Digit Login PIN (পিন দিন) *</span>
                      </label>
                      <span className="text-[10px] text-muted-foreground">Default: 123456</span>
                    </div>

                    <div className="relative">
                      <Input
                        type="password"
                        maxLength={6}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="••••••"
                        value={staffPin}
                        onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        required
                        className="text-center font-mono font-black text-2xl tracking-[0.5em] h-12 rounded-xl"
                        autoComplete="off"
                        disabled={isLoading}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">
                      Enter the 6-digit PIN created by the business owner.
                    </p>
                  </div>
                </CardContent>

                <CardFooter className="p-5 pt-1 flex flex-col gap-2.5">
                  <Button
                    type="submit"
                    className="w-full text-xs font-black bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md shadow-emerald-500/20"
                    disabled={isLoading || !selectedStaffId || staffPin.length !== 6}
                  >
                    {isLoading ? "Verifying PIN..." : "🚀 Log In to My Deliveries (স্টাফ প্রবেশ করুন)"}
                  </Button>
                </CardFooter>
              </form>
            </div>
          )}
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          AquaTrack ERP &bull; Delivery Route Staff & Administrator Portal
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
