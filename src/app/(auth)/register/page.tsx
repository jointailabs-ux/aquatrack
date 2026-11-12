"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Droplets, ShieldCheck, ArrowRight, Phone } from "lucide-react";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-primary items-center justify-center text-primary-foreground shadow-sm">
            <Droplets className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            AquaTrack <span className="text-primary font-normal">ERP</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Single-Location Water Distribution Platform
          </p>
        </div>

        <Card className="border-border shadow-md">
          <CardHeader className="p-6 text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg">Staff & Owner Portal Only</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Customer accounts are managed internally by business delivery staff. Self-registration is disabled.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6 pt-0 space-y-4 text-center">
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-2">
              <p>
                To schedule a delivery or request reusable water jars, please contact our distribution desk directly.
              </p>
              <p className="font-semibold text-foreground flex items-center justify-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-primary" />
                Distribution Hotline: +91 80 4123 4567
              </p>
            </div>

            <Link href="/login" className="block w-full">
              <Button className="w-full gap-2">
                Sign In to Owner / Staff Portal
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
