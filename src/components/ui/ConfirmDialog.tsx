"use client";

import * as React from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { AlertTriangle } from "lucide-react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "primary";
  isLoading?: boolean;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  isLoading = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <div className="flex items-start gap-4">
        {variant === "destructive" && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
        )}
        <div className="space-y-1.5 flex-1">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
          {children}
        </div>
      </div>

      <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3 pt-3 border-t border-border/60">
        <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading} className="w-full sm:w-auto">
          {cancelLabel}
        </Button>
        <Button
          variant={variant === "destructive" ? "destructive" : "primary"}
          size="sm"
          onClick={onConfirm}
          isLoading={isLoading}
          className="w-full sm:w-auto"
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
