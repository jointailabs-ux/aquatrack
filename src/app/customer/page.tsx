"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ShieldAlert, ArrowRight } from "lucide-react";

export default function CustomerDashboardPage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-border text-center p-6 space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div>
          <CardTitle className="text-lg">Customer Portal Disabled</CardTitle>
          <CardDescription className="text-xs mt-1">
            AquaTrack operates with an internal staff delivery model. Direct customer login is not supported.
          </CardDescription>
        </div>
        <Link href="/login" className="block w-full">
          <Button className="w-full gap-2">
            Go to Staff / Owner Login
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </Card>
    </div>
  );
}
