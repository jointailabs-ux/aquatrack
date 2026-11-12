import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
  description?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, checked, ...props }, ref) => {
    const generatedId = React.useId();
    const checkboxId = id || generatedId;

    return (
      <div className="flex items-start gap-2.5">
        <div className="relative flex items-center pt-0.5">
          <input
            type="checkbox"
            id={checkboxId}
            ref={ref}
            checked={checked}
            className={cn(
              "peer h-4 w-4 shrink-0 rounded border border-input ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none checked:bg-primary checked:border-primary transition-colors cursor-pointer",
              className
            )}
            {...props}
          />
          <Check className="pointer-events-none absolute left-0.5 top-1 h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100 transition-opacity" />
        </div>
        {(label || description) && (
          <div className="space-y-0.5">
            {label && (
              <label
                htmlFor={checkboxId}
                className="text-sm font-medium leading-none cursor-pointer select-none text-foreground"
              >
                {label}
              </label>
            )}
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        )}
      </div>
    );
  }
);
Checkbox.displayName = "Checkbox";
