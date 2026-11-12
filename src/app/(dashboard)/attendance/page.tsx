"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ArrowRight, Info } from "lucide-react";

export default function AttendancePage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <Info className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold text-foreground">
          Attendance Module Decommissioned
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          In accordance with the simplified business scope, complex HR workflows, biometric punch clocks,
          and leave management have been removed. Staff compensation is tracked directly via simplified
          salaries and advance deductions.
        </p>
        <Link href="/payroll" className="inline-block">
          <Button size="sm" className="gap-2">
            Go to Staff Salaries
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
