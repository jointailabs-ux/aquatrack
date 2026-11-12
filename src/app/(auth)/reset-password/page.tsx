"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Droplets, Lock, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSuccess, setIsSuccess] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }

      setIsSuccess(true);
      setIsLoading(false);
      addToast({
        type: "success",
        title: "Password Updated",
        message: "Your password has been reset successfully. Please sign in with your new password.",
      });

      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reset password.";
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
            Set New Account Password
          </p>
        </div>

        <Card className="border-border shadow-md">
          {isSuccess ? (
            <CardContent className="p-8 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Password Reset Complete</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your password has been updated. Redirecting you to the sign-in page...
              </p>
              <div className="pt-2">
                <Link href="/login" className="w-full block">
                  <Button variant="outline" size="sm" className="w-full gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Sign In Now
                  </Button>
                </Link>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="space-y-1">
                <CardTitle className="text-lg">Create New Password</CardTitle>
                <CardDescription>
                  Enter and confirm your new secure password.
                </CardDescription>
              </CardHeader>

              <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                  {errorMessage && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">New Password</label>
                    <div className="relative">
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="pl-8"
                      />
                      <Lock className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="text-[10px] text-muted-foreground">Minimum 6 characters</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">Confirm New Password</label>
                    <div className="relative">
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="pl-8"
                      />
                      <Lock className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="flex flex-col gap-3">
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Updating Password..." : "Update Password"}
                  </Button>

                  <Link
                    href="/login"
                    className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to sign in
                  </Link>
                </CardFooter>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

