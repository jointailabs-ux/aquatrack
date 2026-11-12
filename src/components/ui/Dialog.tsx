"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}: DialogProps) {
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div
        className={cn(
          "relative z-50 w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-border bg-card p-4 sm:p-6 shadow-xl animate-in zoom-in-95 duration-150",
          className
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-2.5 top-2.5 sm:right-4 sm:top-4 flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors touch-manipulation"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </button>

        {(title || description) && (
          <div className="space-y-1 mb-4 pr-10">
            {title && (
              <h2 className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        )}

        <div>{children}</div>
      </div>
    </div>
  );
}
