"use client";

import * as React from "react";
import {
  Warehouse,
  MapPin,
  Boxes,
  Truck,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getDefaultWarehouse } from "@/modules/warehouses/warehouse.service";
import { WarehouseRecord } from "@/modules/warehouses/warehouse.schema";

export default function CentralWarehousePage() {
  const [warehouse, setWarehouse] = React.useState<WarehouseRecord | null>(null);

  React.useEffect(() => {
    async function load() {
      const res = await getDefaultWarehouse();
      if (res.success && res.data) {
        setWarehouse(res.data);
      } else {
        setWarehouse({
          id: "wh-central",
          location_id: "loc-wh-central",
          name: "AquaTrack Central Distribution Depot",
          address: "Plot 12, Industrial Layout, Whitefield, Bangalore - 560066",
          is_default: true,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-11-01T00:00:00Z",
        });
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Central Warehouse Depot
            </h1>
            <Badge variant="primary" className="text-xs">
              Single Location Architecture
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Operational center for purification plant unloading, jar washing, sanitization, and vehicle loading.
          </p>
        </div>
      </div>

      {/* Main Warehouse Depot Card */}
      <Card className="border-border shadow-xs bg-card">
        <CardHeader className="p-6 pb-4 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Warehouse className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  {warehouse?.name || "AquaTrack Central Distribution Depot"}
                </h2>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  {warehouse?.address || "Plot 12, Industrial Layout, Whitefield, Bangalore"}
                </p>
              </div>
            </div>

            <Badge variant="success" className="text-xs px-2.5 py-1 self-start sm:self-auto">
              Main Operational Hub
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Key Operations Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                <Boxes className="h-4 w-4 text-primary" />
                Finished Goods Storage
              </span>
              <p className="text-2xl font-black text-foreground">450 Full Jars</p>
              <p className="text-[11px] text-muted-foreground">Ready for vehicle route dispatch</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-blue-500" />
                Sanitized Empty Buffer
              </span>
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400">180 Clean Jars</p>
              <p className="text-[11px] text-muted-foreground">Chemical wash completed & ready to fill</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-emerald-500" />
                Active Fleet Staging
              </span>
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">2 Routes</p>
              <p className="text-[11px] text-muted-foreground">Morning load-in & evening reconciliation</p>
            </div>
          </div>

          {/* Operational Policy & Single Warehouse Architecture Notice */}
          <div className="rounded-xl border border-border bg-muted/10 p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Consolidated Single-Depot Inventory Model
            </div>
            <p className="text-muted-foreground leading-relaxed">
              In accordance with the simplified business requirements, all multi-branch and multi-warehouse
              lookups have been removed. The business operates strictly out of this central depot, maintaining
              immutability for all physical inventory movements and jar custody transfers.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
