"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  message?: string;
}

interface ToastInput {
  type: ToastType;
  title: string;
  description?: string;
  message?: string;
}

interface ToastContextType {
  toasts: ToastMessage[];
  showToast: (toast: ToastInput) => void;
  addToast: (toast: ToastInput) => void;
  removeToast: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);

  const showToast = React.useCallback(
    ({ type, title, description, message }: ToastInput) => {
      const id = Math.random().toString(36).substring(2, 9);
      const desc = description || message;
      setToasts((prev) => [...prev, { id, type, title, description: desc }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  const addToast = showToast;

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border bg-card text-card-foreground shadow-lg transition-all animate-in slide-in-from-bottom-5",
              toast.type === "success" && "border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20",
              toast.type === "error" && "border-destructive/30 bg-destructive/5 dark:bg-destructive/20",
              toast.type === "info" && "border-primary/30 bg-primary/5 dark:bg-primary/20"
            )}
          >
            {toast.type === "success" && (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            )}
            {toast.type === "error" && (
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            )}
            {toast.type === "info" && (
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            )}

            <div className="flex-1 space-y-0.5">
              <h4 className="text-xs font-semibold text-foreground">{toast.title}</h4>
              {toast.description && (
                <p className="text-xs text-muted-foreground">{toast.description}</p>
              )}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="text-muted-foreground hover:text-foreground p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
