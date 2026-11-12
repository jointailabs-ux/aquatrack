import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "link";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none select-none touch-manipulation active:scale-[0.99]";

    const variants = {
      primary:
        "bg-primary text-primary-foreground hover:bg-primary-800 active:bg-primary-900 shadow-sm",
      secondary:
        "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border shadow-xs",
      outline:
        "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      destructive:
        "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
      link: "text-primary underline-offset-4 hover:underline p-0 h-auto",
    };

    const sizes = {
      sm: "min-h-[36px] h-8 px-3 text-xs gap-1.5",
      md: "min-h-[42px] sm:min-h-[36px] h-10 sm:h-9 px-4 text-sm gap-2",
      lg: "min-h-[48px] sm:min-h-[44px] h-12 sm:h-11 px-6 text-base gap-2.5",
      icon: "min-h-[42px] min-w-[42px] sm:min-h-[36px] sm:min-w-[36px] h-10 w-10 sm:h-9 sm:w-9 p-0",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
