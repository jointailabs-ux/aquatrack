"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface ModulePlaceholderProps {
  moduleNumber: number;
  title: string;
  category: string;
  phase?: string;
  description: string;
}

export function ModulePlaceholder({
  moduleNumber,
  title,
  category,
  phase,
  description,
}: ModulePlaceholderProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Module ${moduleNumber}: ${title}`}
        description={description}
        badge={
          <Badge variant="outline" className="border-primary/40 text-primary bg-primary/5">
            {phase ? `Admin Module (${phase})` : "Admin Module"}
          </Badge>
        }
      />

      <div className="rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center max-w-2xl mx-auto my-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
          <Lock className="h-8 w-8" />
        </div>

        <h3 className="text-lg font-bold text-foreground">
          {title}
        </h3>

        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Category: {category}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            Enterprise Security Policy Enforced
          </Badge>
        </div>

        <div className="mt-8 flex justify-center gap-3">
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Return to Operations Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
