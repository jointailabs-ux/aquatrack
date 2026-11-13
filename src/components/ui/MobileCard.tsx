"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileCardMetric {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}

export interface MobileCardProps {
  identifier?: string;
  title: string;
  subtitle?: React.ReactNode;
  statusBadge?: React.ReactNode;
  primaryMetric?: MobileCardMetric;
  metrics?: MobileCardMetric[];
  actions?: React.ReactNode;
  expandableContent?: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  onClick?: () => void;
}

export function MobileCard({
  identifier,
  title,
  subtitle,
  statusBadge,
  primaryMetric,
  metrics = [],
  actions,
  expandableContent,
  defaultExpanded = false,
  className,
  onClick,
}: MobileCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-card p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all touch-manipulation space-y-3",
        onClick && "cursor-pointer active:scale-[0.99]",
        className
      )}
      onClick={onClick}
    >
      {/* Top Row: Identifier / Status / Primary Amount */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {identifier && (
            <span className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-tight truncate">
              {identifier}
            </span>
          )}
          {statusBadge}
        </div>

        {primaryMetric && (
          <div className="text-right shrink-0">
            <span
              className={cn(
                "font-bold text-sm",
                primaryMetric.highlight ? "text-primary" : "text-foreground"
              )}
            >
              {primaryMetric.value}
            </span>
            {primaryMetric.label && (
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                {primaryMetric.label}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Main Row: Title & Subtitle */}
      <div className="min-w-0">
        <h4 className="font-bold text-sm text-foreground tracking-tight leading-snug truncate">
          {title}
        </h4>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {subtitle}
          </div>
        )}
      </div>

      {/* Metric Grid (Secondary details in 2 or 3 columns) */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-border/50 text-xs">
          {metrics.map((m, idx) => (
            <div key={idx} className="min-w-0">
              <p className="text-[10px] text-muted-foreground font-medium truncate">
                {m.label}
              </p>
              <p
                className={cn(
                  "font-semibold truncate",
                  m.highlight ? "text-primary" : "text-foreground"
                )}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Section if provided */}
      {expandableContent && (
        <div className="pt-1">
          {isExpanded && (
            <div className="pt-2 pb-1 border-t border-border/60 text-xs animate-in fade-in duration-150">
              {expandableContent}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline mt-1 cursor-pointer"
          >
            {isExpanded ? (
              <>
                <span>Less details</span>
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span>More details</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      )}

      {/* Action Buttons Row */}
      {actions && (
        <div className="pt-2 border-t border-border/60 flex items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

