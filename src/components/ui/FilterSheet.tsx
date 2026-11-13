"use client";

import * as React from "react";
import { Filter, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export interface FilterSheetProps {
  title?: string;
  activeCount?: number;
  onReset?: () => void;
  children: React.ReactNode;
  triggerLabel?: string;
  className?: string;
}

export function FilterSheet({
  title = "Filter Records",
  activeCount = 0,
  onReset,
  children,
  triggerLabel = "Filters",
  className,
}: FilterSheetProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  // Lock background scroll when open on mobile
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  return (
    <>
      <Button
        variant={activeCount > 0 ? "primary" : "outline"}
        size="sm"
        onClick={() => setIsOpen(true)}
        className={cn("gap-1.5 h-9 shrink-0 touch-manipulation", className)}
      >
        <Filter className="h-3.5 w-3.5" />
        <span>{triggerLabel}</span>
        {activeCount > 0 && (
          <Badge
            variant="secondary"
            className="ml-0.5 px-1.5 py-0 text-[10px] h-4 bg-background/30 text-foreground"
          >
            {activeCount}
          </Badge>
        )}
      </Button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Bottom Sheet Drawer */}
          <div className="relative z-10 flex flex-col w-full max-w-lg mx-auto max-h-[80vh] bg-card rounded-t-3xl border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-250 safe-area-bottom overflow-hidden">
            {/* Drag Handle */}
            <div className="pt-2 pb-1 flex justify-center">
              <div className="h-1.5 w-12 bg-muted-foreground/25 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" />
                <h3 className="font-bold text-sm text-foreground">{title}</h3>
                {activeCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {activeCount} active
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1">
                {onReset && activeCount > 0 && (
                  <button
                    type="button"
                    onClick={onReset}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Filter Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {children}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

