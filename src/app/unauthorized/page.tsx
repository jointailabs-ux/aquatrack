import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Lock, ArrowLeft } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6 p-8 rounded-2xl border border-border bg-card shadow-lg">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <Lock className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-amber-600 block">
            401 • Authentication Required
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Sign In Required
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            You must be authenticated to access this resource. Please sign in with an authorized account.
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-2.5">
          <Link href="/login" className="w-full">
            <Button className="w-full">Go to Sign In</Button>
          </Link>
          <Link href="/" className="w-full">
            <Button variant="ghost" size="sm" className="w-full gap-2">
              <ArrowLeft className="h-3.5 w-3.5" />
              Return to Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
