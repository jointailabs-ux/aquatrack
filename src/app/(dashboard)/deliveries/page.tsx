"use client";

import * as React from "react";
import Link from "next/link";
import {
  Truck,
  ArrowRight,
  PackageCheck,
  RotateCcw,
  RefreshCw,
  Calendar,
  User,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MapPin,
  Phone,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Receipt,
  Wrench,
  Info,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/utils";
import {
  getAdminDeliveriesOverview,
  assignOrderToDriver,
} from "@/modules/delivery/delivery.service";
import {
  AdminDeliveriesData,
} from "@/modules/delivery/delivery.schema";
import { getStaffMembers } from "@/modules/staff/staff.service";
import { StaffRecord } from "@/modules/staff/staff.schema";

export default function DeliveriesPage() {
  const { addToast } = useToast();
  const [selectedDate, setSelectedDate] = React.useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [selectedDriver, setSelectedDriver] = React.useState<string>("");
  const [selectedStatus, setSelectedStatus] = React.useState<string>("ALL");
  const [loading, setLoading] = React.useState<boolean>(true);
  const [refreshing, setRefreshing] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [overviewData, setOverviewData] = React.useState<AdminDeliveriesData | null>(null);
  const [staffList, setStaffList] = React.useState<StaffRecord[]>([]);

  // Expanded trip IDs for details
  const [expandedTrips, setExpandedTrips] = React.useState<Record<string, boolean>>({});

  // Assign order state
  const [assigningOrderId, setAssigningOrderId] = React.useState<string | null>(null);
  const [assigneeDriverId, setAssigneeDriverId] = React.useState<string>("");
  const [isAssigning, setIsAssigning] = React.useState<boolean>(false);

  const fetchOverview = React.useCallback(
    async (date: string, driverId?: string, status?: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await getAdminDeliveriesOverview({
          date,
          driverId: driverId || undefined,
          status: status || undefined,
        });

        if (res.success && res.data) {
          setOverviewData(res.data);
          // Auto expand trips by default
          const initialExpanded: Record<string, boolean> = {};
          res.data.trips.forEach((t) => {
            initialExpanded[t.staff_id] = true;
          });
          setExpandedTrips(initialExpanded);
        } else {
          setError(res.error || "Failed to load delivery route overview.");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error loading deliveries overview.";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  React.useEffect(() => {
    async function loadStaff() {
      const res = await getStaffMembers();
      if (res.success && res.data) {
        setStaffList(res.data);
      }
    }
    loadStaff();
    fetchOverview(selectedDate, selectedDriver, selectedStatus);
  }, [fetchOverview, selectedDate, selectedDriver, selectedStatus]);

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    fetchOverview(newDate, selectedDriver, selectedStatus);
  };

  const handleDriverChange = (driverId: string) => {
    setSelectedDriver(driverId);
    fetchOverview(selectedDate, driverId, selectedStatus);
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    fetchOverview(selectedDate, selectedDriver, status);
  };

  const toggleTripExpand = (staffId: string) => {
    setExpandedTrips((prev) => ({
      ...prev,
      [staffId]: !prev[staffId],
    }));
  };

  const handleAssignOrder = async (orderId: string) => {
    if (!assigneeDriverId) {
      addToast({
        type: "error",
        title: "Driver Required",
        message: "Please select a driver from the dropdown to assign this order.",
      });
      return;
    }

    setIsAssigning(true);
    const res = await assignOrderToDriver({
      order_id: orderId,
      driver_id: assigneeDriverId,
    });
    setIsAssigning(false);

    if (res.success) {
      addToast({
        type: "success",
        title: "Order Assigned",
        message: "Order assigned to driver successfully.",
      });
      setAssigningOrderId(null);
      setAssigneeDriverId("");
      fetchOverview(selectedDate, selectedDriver, selectedStatus, true);
    } else {
      addToast({
        type: "error",
        title: "Assignment Error",
        message: res.error || "Failed to assign driver.",
      });
    }
  };

  const metrics = overviewData?.metrics || {
    total_trips: 0,
    total_stops: 0,
    completed_stops: 0,
    pending_stops: 0,
    failed_stops: 0,
    awaiting_assignment_count: 0,
    out_for_delivery_count: 0,
  };

  const trips = overviewData?.trips || [];
  const awaitingOrders = overviewData?.awaiting_assignment_orders || [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Delivery Route Logistics & Fleet Tracking
            </h1>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 bg-emerald-500/5 text-xs">
              Live Database Active
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Real-time driver route manifests, stop execution statuses, customer payment collections, and jar custody balances.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/payments">
            <Button size="sm" variant="outline" className="gap-2 text-xs">
              <Receipt className="h-3.5 w-3.5 text-primary" />
              Evening Cash Settlement
            </Button>
          </Link>

          <Link href="/driver">
            <Button size="sm" variant="secondary" className="gap-2 text-xs">
              Driver Mobile View
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>

          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchOverview(selectedDate, selectedDriver, selectedStatus, true)}
            disabled={refreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Date Input */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> Date:
              </span>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="h-8 text-xs w-36"
              />
            </div>

            {/* Driver Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <User className="h-3.5 w-3.5" /> Driver:
              </span>
              <select
                value={selectedDriver}
                onChange={(e) => handleDriverChange(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
              >
                <option value="">All Drivers</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <Filter className="h-3.5 w-3.5" /> Stop Status:
              </span>
              <select
                value={selectedStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">All Statuses</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="EN_ROUTE">En Route</option>
                <option value="COMPLETED">Completed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>

          <div className="text-xs font-medium text-muted-foreground">
            Showing schedule for: <span className="font-semibold text-foreground">{selectedDate}</span>
          </div>
        </div>
      </div>

      {/* Top Summary KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Active Driver Routes</span>
              <Truck className="h-4 w-4 text-primary shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-foreground">
              {metrics.total_trips} Routes
            </div>
            <p className="text-[11px] text-muted-foreground">
              {metrics.total_stops} total stops scheduled
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Stops Completed</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-600">
              {metrics.completed_stops} / {metrics.total_stops}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {metrics.total_stops > 0
                ? `${Math.round((metrics.completed_stops / metrics.total_stops) * 100)}% route execution`
                : "No stops today"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Orders Out For Delivery</span>
              <Clock className="h-4 w-4 text-blue-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-600">
              {metrics.out_for_delivery_count} Orders
            </div>
            <p className="text-[11px] text-muted-foreground">
              {metrics.pending_stops} pending stops remaining
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Awaiting Assignment</span>
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-amber-600">
              {metrics.awaiting_assignment_count} Orders
            </div>
            <p className="text-[11px] text-muted-foreground">
              {metrics.failed_stops > 0 ? `${metrics.failed_stops} stop(s) failed` : "Unassigned pool"}
            </p>
          </CardContent>
        </Card>
      </div>

      {loading && !overviewData ? (
        <div className="p-12 text-center text-xs text-muted-foreground">
          Loading live route dispatches...
        </div>
      ) : error && !overviewData ? (
        <ErrorState
          title="Failed to Load Deliveries"
          message={error}
          onRetry={() => fetchOverview(selectedDate, selectedDriver, selectedStatus)}
        />
      ) : (
        <>
          {/* Active Route Manifests by Driver */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Driver Delivery Routes ({trips.length})
              </h2>
              <span className="text-xs text-muted-foreground">
                Grouped by Assigned Driver
              </span>
            </div>

            {trips.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
                <Truck className="h-8 w-8 text-muted-foreground mx-auto" />
                <h3 className="text-sm font-semibold text-foreground">No Driver Routes for This Date</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  There are no delivery stops assigned to drivers for {selectedDate}. Assign orders from the dispatch queue below.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {trips.map((trip) => {
                  const progress = trip.total_stops > 0
                    ? Math.round((trip.completed_stops / trip.total_stops) * 100)
                    : 0;
                  const isExpanded = !!expandedTrips[trip.staff_id];

                  return (
                    <Card key={trip.staff_id} className="border-border bg-card shadow-xs">
                      <CardHeader className="p-4 pb-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-base font-bold text-foreground">
                                {trip.driver_name}
                              </h3>
                              <Badge
                                variant={
                                  trip.trip_status === "COMPLETED"
                                    ? "success"
                                    : trip.trip_status === "IN_TRANSIT"
                                    ? "primary"
                                    : "secondary"
                                }
                                className="text-[10px]"
                              >
                                {trip.trip_status.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {trip.driver_phone && (
                                <span className="flex items-center gap-1 font-mono">
                                  <Phone className="h-3 w-3 text-primary" /> {trip.driver_phone}
                                </span>
                              )}
                              <span>•</span>
                              <span>
                                {trip.completed_stops} of {trip.total_stops} Stops Completed ({progress}%)
                              </span>
                              {trip.failed_stops > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="text-rose-500 font-semibold">
                                    {trip.failed_stops} Failed Stop(s)
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleTripExpand(trip.staff_id)}
                              className="text-xs gap-1"
                            >
                              {isExpanded ? (
                                <>
                                  Hide Stops <ChevronUp className="h-3.5 w-3.5" />
                                </>
                              ) : (
                                <>
                                  View Stops ({trip.stops.length}) <ChevronDown className="h-3.5 w-3.5" />
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-muted h-2 rounded-full overflow-hidden mt-3">
                          <div
                            className="bg-primary h-full rounded-full transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </CardHeader>

                      <CardContent className="p-4 pt-0 space-y-4">
                        {/* Route Summary Row */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-0.5">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                              <PackageCheck className="h-3.5 w-3.5 text-blue-500" />
                              Full Jars Delivered
                            </span>
                            <p className="text-sm font-bold text-foreground">
                              {trip.full_jars_delivered} Jars
                            </p>
                          </div>

                          <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-0.5">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                              <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
                              Empties Collected
                            </span>
                            <p className="text-sm font-bold text-foreground">
                              {trip.empty_jars_collected} Jars
                            </p>
                          </div>

                          <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-0.5">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                              <Wrench className="h-3.5 w-3.5 text-rose-500" />
                              Damaged Collected
                            </span>
                            <p className="text-sm font-bold text-foreground">
                              {trip.damaged_jars_collected} Jars
                            </p>
                          </div>

                          <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-0.5">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                              <Receipt className="h-3.5 w-3.5 text-emerald-500" />
                              Route Collections
                            </span>
                            <p className="text-sm font-bold text-emerald-600">
                              {formatCurrency(trip.cash_collected + trip.upi_collected)}
                            </p>
                            <span className="text-[10px] text-muted-foreground block">
                              Cash: {formatCurrency(trip.cash_collected)} • UPI: {formatCurrency(trip.upi_collected)}
                            </span>
                          </div>
                        </div>

                        {/* Detailed Stops Table */}
                        {isExpanded && (
                          <div className="rounded-xl border border-border overflow-x-auto relative">
                            <div className="sm:hidden text-[10px] text-muted-foreground px-3 py-1 bg-muted/40 border-b border-border flex items-center justify-between">
                              <span>Swipe horizontally to view full route stops</span>
                              <span>&rarr;</span>
                            </div>
                            <table className="w-full text-left text-xs min-w-[700px]">
                              <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                                <tr>
                                  <th className="py-2.5 px-3">#</th>
                                  <th className="py-2.5 px-3">Order</th>
                                  <th className="py-2.5 px-3">Customer & Location</th>
                                  <th className="py-2.5 px-3">Ordered Items</th>
                                  <th className="py-2.5 px-3">Custody Action</th>
                                  <th className="py-2.5 px-3">Collection</th>
                                  <th className="py-2.5 px-3 text-center">Status</th>
                                  <th className="py-2.5 px-3 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {trip.stops.map((stop) => (
                                  <tr key={stop.id} className="hover:bg-muted/20 transition-colors">
                                    <td className="py-2.5 px-3 font-bold font-mono text-foreground">
                                      {stop.sequence_number}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                                      {stop.order_number}
                                    </td>
                                    <td className="py-2.5 px-3 max-w-xs">
                                      <p className="font-semibold text-foreground">{stop.customer_name}</p>
                                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                        <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                                        {stop.delivery_address}
                                      </p>
                                      {stop.customer_phone && (
                                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                                          Tel: {stop.customer_phone}
                                        </p>
                                      )}
                                      {stop.delivery_instructions && (
                                        <p className="text-[10px] text-blue-500 font-medium flex items-center gap-1 mt-0.5">
                                          <Info className="h-3 w-3 shrink-0" />
                                          {stop.delivery_instructions}
                                        </p>
                                      )}
                                      {stop.failure_reason && (
                                        <p className="text-[10px] text-rose-500 font-semibold flex items-center gap-1 mt-0.5">
                                          <AlertTriangle className="h-3 w-3 shrink-0" />
                                          Failed: {stop.failure_reason}
                                        </p>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="space-y-0.5">
                                        {stop.items.map((it) => (
                                          <div key={it.product_id} className="text-[11px]">
                                            <span className="font-medium text-foreground">{it.product_name}</span>{" "}
                                            <span className="text-muted-foreground">x{it.ordered_quantity}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {stop.status === "COMPLETED" ? (
                                        <div className="text-[11px] space-y-0.5">
                                          <span className="text-emerald-600 font-medium block">
                                            +{stop.actual_delivered_quantity} Full Dropped
                                          </span>
                                          <span className="text-amber-600 block">
                                            -{stop.empty_jars_collected} Empties Ret.
                                          </span>
                                          {stop.damaged_jars_collected > 0 && (
                                            <span className="text-rose-500 block">
                                              -{stop.damaged_jars_collected} Damaged
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground text-[11px]">Pending execution</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {stop.payment_collected > 0 ? (
                                        <div>
                                          <span className="font-bold text-foreground">
                                            {formatCurrency(stop.payment_collected)}
                                          </span>
                                          <Badge variant="outline" className="text-[9px] py-0 px-1 ml-1.5">
                                            {stop.payment_method}
                                          </Badge>
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground text-[11px]">
                                          {stop.status === "COMPLETED" ? "No Payment (Credit)" : "-"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <Badge
                                        variant={
                                          stop.status === "COMPLETED"
                                            ? "success"
                                            : stop.status === "FAILED"
                                            ? "destructive"
                                            : stop.status === "EN_ROUTE"
                                            ? "primary"
                                            : "secondary"
                                        }
                                        className="text-[10px]"
                                      >
                                        {stop.status}
                                      </Badge>
                                    </td>
                                    <td className="py-2.5 px-3 text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <Link
                                          href="/orders"
                                          className="text-[11px] font-medium text-primary hover:underline"
                                        >
                                          Order
                                        </Link>
                                        <span>•</span>
                                        <Link
                                          href="/customers"
                                          className="text-[11px] font-medium text-primary hover:underline"
                                        >
                                          Customer
                                        </Link>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Orders Awaiting Driver Assignment Section */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-amber-500" />
                  Orders Awaiting Driver Assignment ({awaitingOrders.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Confirmed customer orders requiring driver and vehicle assignment for route dispatch.
                </p>
              </div>
              <Badge variant="warning" className="text-xs">
                Dispatch Pool
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {awaitingOrders.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  All active orders are currently assigned to delivery drivers.
                </div>
              ) : (
                <div className="overflow-x-auto relative">
                  <div className="sm:hidden text-[10px] text-muted-foreground px-4 py-1.5 bg-muted/40 border-b border-border flex items-center justify-between">
                    <span>Swipe horizontally to assign drivers</span>
                    <span>&rarr;</span>
                  </div>
                  <table className="w-full text-left text-xs min-w-[650px]">
                    <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                      <tr>
                        <th className="py-2.5 px-4 font-semibold">Order #</th>
                        <th className="py-2.5 px-4 font-semibold">Customer</th>
                        <th className="py-2.5 px-4 font-semibold">Delivery Location</th>
                        <th className="py-2.5 px-4 font-semibold">Delivery Date</th>
                        <th className="py-2.5 px-4 font-semibold">Order Total</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Assign Driver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {awaitingOrders.map((ord) => (
                        <tr key={ord.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-foreground">
                            {ord.order_number}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-foreground">{ord.customer_name}</p>
                            {ord.customer_phone && (
                              <p className="text-[11px] text-muted-foreground font-mono">
                                {ord.customer_phone}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4 max-w-xs text-muted-foreground leading-snug">
                            {ord.delivery_address}
                          </td>
                          <td className="py-3 px-4 font-medium text-foreground">
                            {ord.delivery_date}
                          </td>
                          <td className="py-3 px-4 font-bold text-foreground">
                            {formatCurrency(ord.total_amount)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {assigningOrderId === ord.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <select
                                  value={assigneeDriverId}
                                  onChange={(e) => setAssigneeDriverId(e.target.value)}
                                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-hidden"
                                >
                                  <option value="">Select Driver...</option>
                                  {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.full_name}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  size="sm"
                                  onClick={() => handleAssignOrder(ord.id)}
                                  disabled={isAssigning}
                                  className="h-8 text-xs"
                                >
                                  {isAssigning ? "Assigning..." : "Confirm"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setAssigningOrderId(null)}
                                  className="h-8 text-xs"
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setAssigningOrderId(ord.id);
                                  setAssigneeDriverId("");
                                }}
                                className="h-8 text-xs gap-1"
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                Assign Driver
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
