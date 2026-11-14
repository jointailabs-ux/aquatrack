"use client";

import * as React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  variant?: "icon" | "pill" | "segmented";
}

export function ThemeToggle({ className, variant = "icon" }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Avoid hydration mismatch by rendering a neutral placeholder with same dimensions
    return (
      <div
        className={cn(
          "h-9 w-9 rounded-xl border border-border bg-card/60 flex items-center justify-center text-muted-foreground",
          className
        )}
      />
    );
  }

  if (variant === "segmented") {
    return (
      <div className={cn("inline-flex items-center p-1 rounded-xl bg-muted/80 border border-border gap-1", className)}>
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
            theme === "light"
              ? "bg-card text-foreground shadow-xs border border-border/80"
              : "text-muted-foreground hover:text-foreground hover:bg-card/40"
          )}
          title="Light Theme"
        >
          <Sun className="h-3.5 w-3.5 text-amber-500" />
          <span>Light</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
            theme === "dark"
              ? "bg-card text-foreground shadow-xs border border-border/80"
              : "text-muted-foreground hover:text-foreground hover:bg-card/40"
          )}
          title="Dark Theme"
        >
          <Moon className="h-3.5 w-3.5 text-sky-400" />
          <span>Dark</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("system")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
            theme === "system"
              ? "bg-card text-foreground shadow-xs border border-border/80"
              : "text-muted-foreground hover:text-foreground hover:bg-card/40"
          )}
          title="System Auto Theme"
        >
          <Monitor className="h-3.5 w-3.5 text-slate-400" />
          <span>Auto</span>
        </button>
      </div>
    );
  }

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-accent text-foreground text-xs font-bold transition-all active:scale-95 shadow-xs cursor-pointer",
          className
        )}
        title={`Current: ${resolvedTheme === "dark" ? "Dark Theme" : "Light Theme"}. Click to switch.`}
        aria-label="Toggle dark/light theme"
      >
        {resolvedTheme === "dark" ? (
          <>
            <Sun className="h-4 w-4 text-amber-400 animate-in spin-in-180 duration-200" />
            <span>Light Mode</span>
          </>
        ) : (
          <>
            <Moon className="h-4 w-4 text-sky-600 animate-in spin-in-180 duration-200" />
            <span>Dark Mode</span>
          </>
        )}
      </button>
    );
  }

  // Default compact icon button
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/80 hover:bg-accent text-foreground transition-all duration-200 active:scale-95 shadow-2xs hover:shadow-xs cursor-pointer",
        resolvedTheme === "dark"
          ? "border-sky-500/30 hover:border-sky-400 bg-slate-900/60"
          : "border-border hover:border-primary/40 bg-white",
        className
      )}
      title={`Current: ${resolvedTheme === "dark" ? "Dark Mode" : "Light Mode"}. Tap to switch theme.`}
      aria-label="Toggle dark/light mode"
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4 text-amber-400 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 text-sky-600 transition-transform hover:-rotate-12" />
      )}
    </button>
  );
}

