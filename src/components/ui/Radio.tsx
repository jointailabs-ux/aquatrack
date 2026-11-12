import * as React from "react";
import { cn } from "@/lib/utils";

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  label?: string;
}

export function RadioGroup({
  name,
  options,
  value,
  onChange,
  className,
  label,
}: RadioGroupProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
      )}
      <div className="space-y-2">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const isChecked = value === option.value;

          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 cursor-pointer transition-colors shadow-xs",
                isChecked && "border-primary bg-primary/5 ring-1 ring-primary",
                option.disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <input
                type="radio"
                id={id}
                name={name}
                value={option.value}
                checked={isChecked}
                disabled={option.disabled}
                onChange={() => onChange?.(option.value)}
                className="mt-0.5 h-4 w-4 text-primary border-input focus:ring-primary focus:ring-offset-1"
              />
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-foreground block">
                  {option.label}
                </span>
                {option.description && (
                  <span className="text-xs text-muted-foreground block">
                    {option.description}
                  </span>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
