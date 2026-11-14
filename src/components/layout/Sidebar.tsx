"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAVIGATION_GROUPS } from "@/lib/constants";
import { Droplets, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAppSession } from "@/components/providers/AppSessionProvider";

export interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  className?: string;
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const { logoUrl } = useAppSession();

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-slate-800 bg-slate-900 text-slate-100 transition-all duration-200 z-30 select-none shadow-xl",
        isCollapsed ? "w-16" : "w-64",
        className
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-slate-800/80">
        <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
          {logoUrl ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 p-1 shadow-xs overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Business Logo"
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-500 via-sky-400 to-cyan-300 text-slate-950 shadow-md shadow-sky-500/30">
              <Droplets className="h-5 w-5" />
            </div>
          )}
          {!isCollapsed && (
            <div className="flex flex-col truncate">
              <span className="font-extrabold text-sm tracking-tight text-white truncate">
                AquaTrack <span className="text-sky-400 font-bold">ERP</span>
              </span>
              <span className="text-[10px] text-sky-300/70 uppercase tracking-widest font-semibold truncate">
                Distribution Hub
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Collapse Toggle Button */}
      <button
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-20 z-40 hidden md:flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-300 shadow-md hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
      >
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
        {NAVIGATION_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            {!isCollapsed && (
              <h4 className="px-3 text-[11px] font-extrabold uppercase tracking-wider text-sky-400/90 mb-2">
                {group.label}
              </h4>
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                const isClickable = item.isImplemented;

                if (!isClickable) {
                  return (
                    <div
                      key={item.title}
                      title={`${item.title} (Available in Phase ${item.moduleNumber > 10 ? '4-9' : '4'})`}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 cursor-not-allowed select-none group",
                        isCollapsed && "justify-center px-0"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-slate-600" />
                      {!isCollapsed && (
                        <div className="flex items-center justify-between flex-1 truncate">
                          <span className="truncate">{item.title}</span>
                          <Lock className="h-3 w-3 text-slate-600 ml-2 shrink-0" />
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.title}
                    href={item.href}
                    title={isCollapsed ? item.title : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-all select-none cursor-pointer",
                      isActive
                        ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25 font-bold"
                        : "text-slate-300 hover:bg-slate-800/80 hover:text-white",
                      isCollapsed && "justify-center px-0"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-white" : "text-slate-400"
                      )}
                    />
                    {!isCollapsed && (
                      <span className="truncate">{item.title}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info & Theme Toggle */}
      <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
        {!isCollapsed ? (
          <>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-slate-300">AquaTrack ERP</span>
              <span className="text-[9px] text-emerald-400 font-semibold">● v1.0 Live</span>
            </div>
            <ThemeToggle variant="pill" className="h-7 px-2 text-[11px] bg-slate-900 border-slate-700 text-slate-200" />
          </>
        ) : (
          <div className="w-full flex justify-center">
            <ThemeToggle className="h-8 w-8 bg-slate-900 border-slate-700 text-slate-200" />
          </div>
        )}
      </div>
    </aside>
  );
}
