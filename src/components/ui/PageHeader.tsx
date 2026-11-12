import * as React from "react";
import { cn } from "@/lib/utils";
import { Breadcrumbs, BreadcrumbItem } from "./Breadcrumbs";

export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  badge,
  breadcrumbs,
  actions,
  action,
  className,
}: PageHeaderProps) {
  const actionContent = actions || action;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 pb-5 border-b border-border/60 mb-6",
        className
      )}
    >
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-1" />}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words">
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <p className="text-xs sm:text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actionContent && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0 w-full sm:w-auto pt-1 sm:pt-0">
            {actionContent}
          </div>
        )}
      </div>
    </div>
  );
}
