"use client";

import * as React from "react";
import { Truck } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function VehiclesFleetPage() {
  const vehicles = [
    {
      id: "veh-1",
      plate_number: "KA-01-EQ-4421",
      model: "Tata Ace Gold (Diesel)",
      capacity_jars: 80,
      assigned_driver: "Ramesh Kumar",
      insurance_valid_until: "2027-04-15",
      puc_valid_until: "2027-02-28",
      status: "ACTIVE",
    },
    {
      id: "veh-2",
      plate_number: "KA-01-EQ-5590",
      model: "Mahindra Bolero Maxi Truck Plus",
      capacity_jars: 100,
      assigned_driver: "Suresh Patil",
      insurance_valid_until: "2027-06-30",
      puc_valid_until: "2027-03-15",
      status: "ACTIVE",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Delivery Fleet & Vehicles
            </h1>
            <Badge variant="primary" className="text-xs">
              Fleet Operations
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Manage delivery vans, payload jar capacities, driver assignments, and vehicle road-worthiness.
          </p>
        </div>
      </div>

      {/* Vehicle Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {vehicles.map((v) => (
          <Card key={v.id} className="border-border shadow-xs bg-card">
            <CardHeader className="p-5 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-foreground font-mono">
                    {v.plate_number}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                    {v.model}
                  </p>
                </div>
                <Badge variant="success" className="text-xs">
                  {v.status}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-5 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">
                    Carrying Capacity
                  </span>
                  <p className="text-base font-black text-foreground">
                    {v.capacity_jars} Jars (20L)
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">
                    Assigned Driver
                  </span>
                  <p className="text-base font-bold text-foreground truncate">
                    {v.assigned_driver}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-muted-foreground pt-1 border-t border-border/60">
                <div className="flex justify-between">
                  <span>Insurance Policy Validity:</span>
                  <span className="font-medium text-foreground">{v.insurance_valid_until}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pollution (PUC) Validity:</span>
                  <span className="font-medium text-foreground">{v.puc_valid_until}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
