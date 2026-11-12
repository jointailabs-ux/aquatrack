import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize = 10,
  onPageChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1 && !totalItems) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems ?? 0);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-2 py-3 text-xs text-muted-foreground w-full",
        className
      )}
    >
      {totalItems !== undefined && (
        <div className="text-center sm:text-left">
          Showing <span className="font-medium text-foreground">{startItem}</span> to{" "}
          <span className="font-medium text-foreground">{endItem}</span> of{" "}
          <span className="font-medium text-foreground">{totalItems}</span> results
        </div>
      )}

      <div className="flex items-center justify-between sm:justify-end gap-1.5 w-full sm:w-auto sm:ml-auto">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="h-8 px-2.5"
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-1" />
          Previous
        </Button>

        <span className="px-2 text-xs font-medium text-foreground">
          Page {currentPage} of {Math.max(1, totalPages)}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="h-8 px-2.5"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}
