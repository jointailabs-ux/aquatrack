import { z } from "zod";

export const OrderStatusEnum = z.enum([
  "PENDING",
  "CONFIRMED",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "CANCELLED",
]);

export type OrderStatus = z.infer<typeof OrderStatusEnum>;

export const OrderPaymentStatusEnum = z.enum(["PENDING", "PARTIALLY_PAID", "PAID"]);
export type OrderPaymentStatus = z.infer<typeof OrderPaymentStatusEnum>;

export const OrderPaymentMethodEnum = z.enum(["CASH", "UPI", "CREDIT"]);
export type OrderPaymentMethod = z.infer<typeof OrderPaymentMethodEnum>;

export const OrderItemSchema = z.object({
  product_id: z.string().uuid("Product ID is required"),
  product_name: z.string().min(1, "Product name required"),
  quantity: z.number().int().positive("Quantity must be positive"),
  unit_price: z.number().nonnegative("Unit price must be non-negative"),
  gst_rate: z.number().nonnegative("GST rate must be non-negative").default(0),
  tax_amount: z.number().nonnegative("Tax amount must be non-negative").default(0),
  total_amount: z.number().nonnegative("Line total must be non-negative"),
  is_reusable_jar: z.boolean().default(false),
});

export type OrderItem = z.infer<typeof OrderItemSchema>;

export const CreateOrderSchema = z.object({
  customer_id: z.string().uuid("Customer is required"),
  assigned_staff_id: z.preprocess((val) => (!val ? null : val), z.string().uuid().nullable().optional()),
  order_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  delivery_date: z.string().min(1, "Delivery date is required"),
  delivery_address: z.string().min(5, "Delivery address required"),
  notes: z.string().max(500).optional().nullable(),
  idempotency_key: z.string().max(100).optional().nullable(),
  price_override_reason: z.string().max(255).optional().nullable(),
  items: z.array(OrderItemSchema).min(1, "At least one product item is required"),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const DeliveryExecutionItemSchema = z.object({
  product_id: z.string().uuid("Product ID is required"),
  quantity_delivered: z.number().int().nonnegative("Delivered quantity must be non-negative"),
});

export type DeliveryExecutionItem = z.infer<typeof DeliveryExecutionItemSchema>;

export const DeliveryExecutionSchema = z
  .object({
    order_id: z.string().uuid("Order ID is required"),
    stop_id: z.string().uuid("Stop ID must be a valid UUID").optional().nullable(),
    actual_quantity_delivered: z.number().int().nonnegative("Delivered quantity must be non-negative"),
    empty_jars_collected: z.number().int().nonnegative("Empty jars collected must be non-negative").default(0),
    damaged_jars_collected: z.number().int().nonnegative("Damaged jars collected must be non-negative").default(0),
    amount_collected: z.number().nonnegative("Amount collected must be non-negative").default(0),
    payment_method: OrderPaymentMethodEnum.default("CASH"),
    payment_reference: z.string().max(100).optional().nullable(),
    delivery_notes: z.string().max(500).optional().nullable(),
    failure_reason: z.string().max(255).optional().nullable(),
    items: z.array(DeliveryExecutionItemSchema).optional().nullable(),
  })
  .refine(
    (data) => {
      if (!data.items || data.items.length === 0) return true;
      const productIds = data.items.map((i) => i.product_id);
      return new Set(productIds).size === productIds.length;
    },
    {
      message: "Duplicate product_id found in delivery items payload.",
      path: ["items"],
    }
  )
  .refine(
    (data) => {
      if (!data.items || data.items.length === 0) return true;
      const sumItems = data.items.reduce((sum, i) => sum + i.quantity_delivered, 0);
      return sumItems === data.actual_quantity_delivered;
    },
    {
      message: "Aggregate delivered quantity does not match sum of item quantities.",
      path: ["actual_quantity_delivered"],
    }
  );

export type DeliveryExecutionInput = z.infer<typeof DeliveryExecutionSchema>;

export const CancelOrderSchema = z.object({
  order_id: z.string().uuid("Order ID must be a valid UUID"),
  reason: z.string().max(500, "Cancellation reason must not exceed 500 characters").optional().nullable(),
});

export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;

export interface CancelOrderResult {
  order_id: string;
  order_number: string;
  status: OrderStatus;
  released_reservation: boolean;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  order_date: string;
  delivery_date: string;
  delivery_address: string;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  subtotal: number;
  tax_total: number;
  total_amount: number;
  amount_paid: number;
  items: OrderItem[];
  notes?: string | null;
  delivery_instructions?: string | null;
  failure_reason?: string | null;
  stop_id?: string | null;
  // Execution fields recorded upon delivery completion
  actual_quantity_delivered?: number;
  empty_jars_collected?: number;
  damaged_jars_collected?: number;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
}
