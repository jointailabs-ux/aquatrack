import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ShieldAlert, ArrowLeft } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6 p-8 rounded-2xl border border-border bg-card shadow-lg">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-destructive block">
            403 • Access Forbidden
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Insufficient Permissions
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your current system role does not have authorization to view this module. Internal financial ledgers, salary data, and executive settings require elevated privileges.
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-2.5">
          <Link href="/dashboard" className="w-full">
            <Button className="w-full">Return to Dashboard</Button>
          </Link>
          <Link href="/login" className="w-full">
            <Button variant="ghost" size="sm" className="w-full gap-2">
              <ArrowLeft className="h-3.5 w-3.5" />
              Switch Account
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
