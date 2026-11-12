"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Truck, LogOut, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { addToast } = useToast();

  const handleLogout = () => {
    addToast({
      type: "info",
      title: "Driver Shift Logged Out",
      message: "Driver session ended. Make sure trip cash float is handed over.",
    });
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col max-w-md md:max-w-xl lg:max-w-2xl mx-auto shadow-2xl border-x border-slate-800 safe-area-bottom">
      {/* Mobile Driver Header */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-xs border-b border-slate-800 px-3 sm:px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white font-bold shadow-xs shrink-0">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-white">
                AquaTrack <span className="text-blue-400 font-normal">Driver</span>
              </span>
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              Ramesh Kumar • Vehicle #KA-01-E-9022
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="border-blue-500/40 text-blue-300 bg-blue-500/10 text-[10px] py-0 px-1.5">
            Route 2
          </Badge>
          <button
            onClick={handleLogout}
            className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors touch-manipulation"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Driver Content */}
      <main className="flex-1 p-4 space-y-4 overflow-y-auto">
        {children}
      </main>

      {/* Mobile Footer Status */}
      <footer className="sticky bottom-0 bg-slate-950 border-t border-slate-800 px-4 py-2 text-center text-[10px] text-slate-400 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-emerald-400">
          <Wifi className="h-3 w-3" />
          <span>Trip #TRP-104 Active (Sync Online)</span>
        </div>
        <span className="text-slate-400">Phase 3 Mobile Shell</span>
      </footer>
    </div>
  );
}
