"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Filter, ChevronDown } from "lucide-react";
import { Button } from "./Button";

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  selected?: string;
  onSelect: (value: string) => void;
  className?: string;
}

export function FilterDropdown({
  label,
  options,
  selected,
  onSelect,
  className,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel = options.find((o) => o.value === selected)?.label;

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-2 text-xs font-medium"
      >
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{selectedLabel ? `${label}: ${selectedLabel}` : label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>

      {isOpen && (
        <div className="absolute left-0 sm:left-auto sm:right-0 z-50 mt-1 min-w-[160px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-1 shadow-md animate-in fade-in-80">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onSelect(opt.value);
                setIsOpen(false);
              }}
              className={cn(
                "flex min-h-[38px] w-full items-center px-3 py-2 text-xs rounded-md text-foreground hover:bg-accent transition-colors touch-manipulation",
                selected === opt.value && "bg-primary/10 text-primary font-medium"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
