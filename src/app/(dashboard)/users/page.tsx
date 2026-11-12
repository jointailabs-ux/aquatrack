"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ArrowRight, UserCheck } from "lucide-react";

export default function UsersRedirectPage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/staff");
  }, [router]);

  return (
    <div className="py-12 text-center space-y-4">
      <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <UserCheck className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-bold text-foreground">User Management Consolidated</h2>
      <p className="text-xs text-muted-foreground">
        Redirecting to Staff Management & Modular RBAC...
      </p>
      <Link href="/staff">
        <Button size="sm" className="gap-2">
          Open Staff Management
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}
