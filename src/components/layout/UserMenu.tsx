"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, LogOut, Shield, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { UserRole } from "@/types/auth.types";
import { ROLE_PERMISSIONS } from "@/types/auth.types";
import { useToast } from "@/components/ui/Toast";

import { createClient } from "@/lib/supabase/client";
import { useAppSession } from "@/components/providers/AppSessionProvider";

interface UserMenuProps {
  currentUser?: {
    name: string;
    email: string;
    role: UserRole;
  };
}

export function UserMenu({
  currentUser,
}: UserMenuProps) {
  const { user: sessionUser } = useAppSession();
  const userData = currentUser || sessionUser;
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { addToast } = useToast();

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsOpen(false);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Fallback
    }

    addToast({
      type: "info",
      title: "Signed Out",
      message: "You have been logged out of the session.",
    });
    router.push("/login");
    router.refresh();
  };

  const roleMeta = ROLE_PERMISSIONS[userData.role];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg p-1 hover:bg-accent/60 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User account menu"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-sky-500 to-blue-600 text-white font-bold text-xs shadow-xs shrink-0">
          {userData.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="hidden text-left md:block">
          <div className="text-xs font-semibold leading-tight text-foreground truncate max-w-[120px]">
            {userData.name}
          </div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[120px]">
            {roleMeta?.title ?? userData.role}
          </div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden md:block" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100 max-w-[calc(100vw-1.5rem)]">
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-xs font-semibold text-foreground truncate">
              {userData.name}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {userData.email}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-semibold">
                <Shield className="h-2.5 w-2.5 mr-1" />
                {roleMeta?.title || userData.role}
              </Badge>
              <span className="text-[10px] text-muted-foreground">Internal</span>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/settings"
              onClick={() => setIsOpen(false)}
              className="flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors touch-manipulation"
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <span>Account Settings</span>
            </Link>
          </div>

          <div className="border-t border-border pt-1">
            <button
              onClick={handleLogout}
              className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors touch-manipulation"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
