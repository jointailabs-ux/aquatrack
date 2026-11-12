"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Droplets, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const { addToast } = useToast();
  const [email, setEmail] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setErrorMessage("");

    try {
      const supabase = createClient();
      const redirectUrl = typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : "/reset-password";

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl,
      });

      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setIsSubmitted(true);
      addToast({
        type: "success",
        title: "Reset Link Sent",
        message: `Password recovery email sent to ${email.trim()}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send reset link.";
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
            Account Password Recovery
          </p>
        </div>

        <Card className="border-border shadow-md">
          {isSubmitted ? (
            <CardContent className="p-8 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Check Your Email</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                If an account exists for <span className="font-semibold text-foreground">{email}</span>, you will receive a secure password reset link. Click the link in your email to choose a new password.
              </p>
              <div className="pt-2">
                <Link href="/login" className="w-full block">
                  <Button variant="outline" size="sm" className="w-full gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Sign In
                  </Button>
                </Link>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="space-y-1">
                <CardTitle className="text-lg">Reset Password</CardTitle>
                <CardDescription>
                  Enter your registered email address and we will send you a secure recovery link.
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
                    <label className="text-xs font-semibold text-foreground">Email Address</label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      required
                    />
                  </div>
                </CardContent>

                <CardFooter className="flex flex-col gap-3">
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Sending Link..." : "Send Reset Link"}
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
