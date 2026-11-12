import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { Loader2 } from "lucide-react";

export interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (item: T) => void;
  className?: string;
  renderMobileCard?: (item: T, index: number) => React.ReactNode;
}

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  isLoading = false,
  emptyTitle = "No records found",
  emptyDescription = "There are no records matching your current filter.",
  onRowClick,
  className,
  renderMobileCard,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className={cn("w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs p-8 text-center", className)}>
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-xs">Loading data...</span>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn("w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs py-12", className)}>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className={cn("w-full space-y-3", className)}>
      {/* Mobile Card Layout (if provided) */}
      {renderMobileCard && (
        <div className="space-y-3 md:hidden">
          {data.map((item, rowIdx) => (
            <div
              key={item.id ? String(item.id) : rowIdx}
              onClick={() => onRowClick?.(item)}
              className={cn(
                "rounded-xl border border-border bg-card p-3.5 shadow-2xs transition-colors hover:border-primary/40",
                onRowClick && "cursor-pointer"
              )}
            >
              {renderMobileCard(item, rowIdx)}
            </div>
          ))}
        </div>
      )}

      {/* Desktop / Horizontal Scroll Table */}
      <div
        className={cn(
          "w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs",
          renderMobileCard && "hidden md:block"
        )}
      >
        {!renderMobileCard && (
          <div className="md:hidden flex items-center justify-end px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/40 bg-muted/20">
            <span>Swipe horizontally for full table &rarr;</span>
          </div>
        )}
        <div className="overflow-x-auto scrollbar-thin">
          <table className={cn("w-full text-left text-sm", !renderMobileCard && "min-w-[550px]")}>
            <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                {columns.map((col, idx) => (
                  <th key={idx} className={cn("px-4 py-3", col.className)}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.map((item, rowIdx) => (
                <tr
                  key={item.id ? String(item.id) : rowIdx}
                  onClick={() => onRowClick?.(item)}
                  className={cn(
                    "transition-colors hover:bg-muted/30",
                    onRowClick && "cursor-pointer"
                  )}
                >
                  {columns.map((col, colIdx) => (
                    <td
                      key={colIdx}
                      className={cn("px-4 py-3 text-foreground align-middle", col.className)}
                    >
                      {col.cell
                        ? col.cell(item)
                        : col.accessorKey
                        ? String(item[col.accessorKey] ?? "-")
                        : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
