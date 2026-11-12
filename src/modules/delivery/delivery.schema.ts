import { z } from "zod";

export const DeliveryStopStatusEnum = z.enum([
  "ASSIGNED",
  "EN_ROUTE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type DeliveryStopStatus = z.infer<typeof DeliveryStopStatusEnum>;

export const TripStatusEnum = z.enum([
  "IDLE",
  "ASSIGNED",
  "IN_TRANSIT",
  "COMPLETED",
]);
export type TripStatus = z.infer<typeof TripStatusEnum>;

export const CashHandoverStatusEnum = z.enum([
  "PENDING_VERIFICATION",
  "SETTLED",
  "DISCREPANCY",
]);
export type CashHandoverStatus = z.infer<typeof CashHandoverStatusEnum>;

export interface DeliveryItemDetail {
  product_id: string;
  product_name: string;
  ordered_quantity: number;
  delivered_quantity: number;
  is_reusable_jar: boolean;
}

export interface DeliveryStopDetail {
  id: string;
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_instructions?: string | null;
  sequence_number: number;
  status: DeliveryStopStatus;
  order_total_amount: number;
  actual_delivered_quantity: number;
  empty_jars_collected: number;
  damaged_jars_collected: number;
  payment_collected: number;
  payment_method?: "CASH" | "UPI" | "CREDIT" | null;
  delivery_notes?: string | null;
  failure_reason?: string | null;
  executed_at?: string | null;
  items: DeliveryItemDetail[];
}

export interface DeliveryTripOverview {
  staff_id: string;
  driver_name: string;
  driver_phone: string;
  date: string;
  trip_status: TripStatus;
  total_stops: number;
  completed_stops: number;
  pending_stops: number;
  failed_stops: number;
  full_jars_delivered: number;
  empty_jars_collected: number;
  damaged_jars_collected: number;
  cash_collected: number;
  upi_collected: number;
  stops: DeliveryStopDetail[];
}

export interface AdminDeliveriesData {
  date: string;
  trips: DeliveryTripOverview[];
  metrics: {
    total_trips: number;
    total_stops: number;
    completed_stops: number;
    pending_stops: number;
    failed_stops: number;
    awaiting_assignment_count: number;
    out_for_delivery_count: number;
  };
  awaiting_assignment_orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    delivery_address: string;
    delivery_date: string;
    total_amount: number;
    items_count: number;
  }>;
}

export interface DriverPaymentSettlementRecord {
  payment_id: string;
  payment_number: string;
  payment_date: string;
  driver_id: string;
  driver_name: string;
  customer_id: string;
  customer_name: string;
  order_id: string;
  order_number: string;
  invoice_id?: string | null;
  amount: number;
  payment_method: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
  reference_number: string;
  is_settled: boolean;
  handover_id?: string | null;
}

export interface DriverDailySettlementSummary {
  driver_id: string;
  driver_name: string;
  driver_phone: string;
  date: string;
  opening_float: number;
  route_cash_collected: number;
  on_route_expenses: number;
  expected_cash: number;
  cash_handed_over: number;
  upi_collected: number;
  variance: number;
  status: CashHandoverStatus;
  handover_id?: string | null;
  settled_at?: string | null;
  verified_by?: string | null;
  verified_by_name?: string | null;
  payments: DriverPaymentSettlementRecord[];
}

export const SettleDriverCashSchema = z.object({
  driver_id: z.string().uuid("Invalid driver ID"),
  handover_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  opening_float: z.number().nonnegative("Opening float must be non-negative").default(0),
  cash_handed_over: z.number().nonnegative("Cash handed over must be non-negative"),
  on_route_expenses: z.number().nonnegative("Expenses must be non-negative").default(0),
  notes: z.string().max(500).optional().nullable(),
});

export type SettleDriverCashInput = z.infer<typeof SettleDriverCashSchema>;

export const AssignOrderToDriverSchema = z.object({
  order_id: z.string().uuid("Invalid order ID"),
  driver_id: z.string().uuid("Invalid driver ID"),
});

export type AssignOrderToDriverInput = z.infer<typeof AssignOrderToDriverSchema>;

