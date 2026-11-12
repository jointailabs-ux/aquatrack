"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronRight, Home } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const pathname = usePathname();

  const breadcrumbsList = React.useMemo(() => {
    if (items && items.length > 0) return items;

    // Auto-generate from pathname
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return [];

    return segments.map((seg, idx) => {
      const href = "/" + segments.slice(0, idx + 1).join("/");
      const formatted = seg
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        label: formatted,
        href: idx === segments.length - 1 ? undefined : href,
      };
    });
  }, [items, pathname]);

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center text-xs text-muted-foreground", className)}
    >
      <Link
        href="/dashboard"
        className="flex items-center hover:text-foreground transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>

      {breadcrumbsList.map((item, index) => {
        const isLast = index === breadcrumbsList.length - 1;

        return (
          <React.Fragment key={index}>
            <ChevronRight className="h-3.5 w-3.5 mx-1.5 shrink-0 text-muted-foreground/60" />
            {isLast || !item.href ? (
              <span className="font-medium text-foreground select-none">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
