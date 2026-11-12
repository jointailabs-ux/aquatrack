# API & TRANSACTION ARCHITECTURE — AquaTrack ERP
**Version 2.0 (Post-Review & Audited)**

---

## 1. Server Actions & API Design Philosophy

AquaTrack ERP utilizes Next.js App Router **Server Actions** as its primary mutation interface, complemented by **Route Handlers** for webhooks, external integrations, and PDF report downloads.

### Core Principles:
1. **Server-Side Security Boundary:** Every Server Action runs exclusively on the Node.js server. The client never initiates direct, un-sanitized database writes.
2. **Strict Zod Validation:** All inputs are validated against shared Zod schemas before database execution.
3. **Typed Result Wrapper:** All Server Actions return a uniform `ActionResponse<T>` data structure to make frontend error handling deterministic and graceful:
   ```typescript
   export type ActionResponse<T> = 
     | { success: true; data: T; error?: never }
     | { success: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };
   ```
4. **Database-Level Atomic Boundaries:** Multi-table operations (such as trip settlements or inventory transfers) are executed within atomic PostgreSQL stored functions (RPCs), preventing partial or orphan writes.

---

## 2. Request-Response Lifecycle Flow

```
[ Mobile Driver / Web UI ]
       │
       │ 1. Form submission / User action
       ▼
[ Zod Validation Layer ]
       │
       │ 2. Parse & Validate Input Types/Constraints
       ├── Invalid ──> Return 400 with fieldErrors to UI
       ▼ Valid
[ Auth & Permission Guard ]
       │
       │ 3. Verify Supabase JWT & Role Permission
       ├── Unauthorized ──> Return 403 Forbidden
       ▼ Authorized
[ Next.js Server Action ]
       │
       │ 4. Check Idempotency Key (if provided)
       ├── Cached Hit ──> Return cached response immediately
       ▼ Fresh Request
[ PostgreSQL Atomic RPC ]
       │
       │ 5. Execute Multi-Table Stored Function (BEGIN ... COMMIT)
       │    - Acquire pessimistic row locks (SELECT ... FOR UPDATE)
       │    - Verify balance availability (prevent negative stock)
       │    - Atomically update stock_balances
       │    - Insert immutable stock_movements ledger entry
       │    - Update customer/driver ledgers
       │    - Write audit_logs entry
       ▼
[ Typed Response Returned ]
       │
       │ 6. Revalidate Next.js cache tags (revalidatePath / revalidateTag)
       ▼
[ Client UI Updates Reactively ]
```

---

## 3. Core PostgreSQL Atomic Stored Functions (RPCs)

### 3.1 `rpc_execute_stock_movement`
**Purpose:** The single, unified atomic engine for transferring physical inventory between any two custody locations.
- **Parameters:**
  - `p_movement_type VARCHAR(40)`
  - `p_source_location_id UUID`
  - `p_destination_location_id UUID`
  - `p_product_id UUID`
  - `p_stock_status VARCHAR(30)`
  - `p_quantity INTEGER`
  - `p_ref_type VARCHAR(40)`
  - `p_ref_id UUID`
  - `p_created_by UUID`
- **Atomic Operations:**
  1. Validates that `p_quantity > 0` and both source and destination locations exist and are active.
  2. Acquires pessimistic lock on source balance:
     ```sql
     SELECT quantity FROM stock_balances 
     WHERE location_id = p_source_location_id 
       AND product_id = p_product_id 
       AND stock_status = p_stock_status 
     FOR UPDATE;
     ```
  3. Verifies source quantity is sufficient. If insufficient, raises `INSUFFICIENT_STOCK_EXCEPTION`.
  4. Decrements source `stock_balances.quantity`.
  5. Increments destination `stock_balances.quantity` (creating the destination row via `INSERT ... ON CONFLICT DO UPDATE` if it does not yet exist).
  6. Inserts immutable audit record into `stock_movements`.
  7. Returns the generated `stock_movement_id`.

### 3.2 `rpc_dispatch_delivery_trip`
**Purpose:** Dispatches a loaded vehicle from the warehouse gate.
- **Parameters:** `p_trip_id UUID`, `p_dispatched_by UUID`
- **Atomic Operations:**
  1. Verifies trip is in `LOADING_VERIFIED` state.
  2. Sums total required full jars across all attached orders.
  3. Calls `rpc_execute_stock_movement` to atomically transfer full jars from the warehouse location to the vehicle mobile location (`movement_type = 'TRIP_LOAD'`).
  4. Disburses `morning_cash_float` from Cash in Safe to Cash with Driver.
  5. Updates trip status to `DISPATCHED` and logs departure timestamp.
  6. Emits audit log entry.

### 3.3 `rpc_record_delivery_stop`
**Purpose:** Logs a customer drop-off by the driver on route with idempotency protection.
- **Parameters:**
  - `p_stop_id UUID`
  - `p_full_delivered INT`
  - `p_empty_collected INT`
  - `p_payment_method VARCHAR`
  - `p_amount_collected NUMERIC`
  - `p_idempotency_key UUID`
- **Atomic Operations:**
  1. Checks `idempotency_keys` table. If key exists, immediately returns the cached response.
  2. Retrieves vehicle location and customer location for the stop.
  3. If `p_full_delivered > 0`: Transfers full jars from vehicle to customer (`movement_type = 'TRIP_DELIVERY'`).
  4. If `p_empty_collected > 0`: Transfers empty jars from customer to vehicle (`movement_type = 'TRIP_RETURN'`).
  5. Updates `customers.total_jars_holding` ($+ \text{Full} - \text{Empty}$).
  6. If payment collected in cash: increments driver's unremitted cash counter (`staff_profiles.current_cash_holding`).
  7. If order is on credit: updates customer's accounts receivable ledger.
  8. Updates `trip_stops` status to `DELIVERED`.
  9. Caches response in `idempotency_keys`.

### 3.4 `rpc_settle_delivery_trip`
**Purpose:** Reconciles physical jar counts and cash collections at the cashier desk.
- **Parameters:**
  - `p_trip_id UUID`
  - `p_gate_full INT`
  - `p_gate_empty INT`
  - `p_gate_damaged INT`
  - `p_cash_counted NUMERIC`
  - `p_cashier_id UUID`
  - `p_shortage_action VARCHAR`
- **Atomic Operations:**
  1. Verifies all trip stops are in terminal state (`DELIVERED` or `FAILED_ABSENT`).
  2. Computes jar discrepancy: $\text{Starting Loaded} - (\text{Delivered} + \text{Returned Full})$.
  3. Computes expected cash: $\text{Float} + \text{Cash Collected} - \text{Approved En-Route Fuel}$.
  4. Computes cash variance: $\text{Cash Counted} - \text{Expected Cash}$.
  5. Unloads remaining full jars and collected empty jars from vehicle back to warehouse.
  6. Routes damaged jars into `DAMAGED_SCRAP`.
  7. If jar shortage exists: books `stock_movements` record of type `AUDIT_DISCREPANCY_SHORTAGE`.
  8. If cash shortage exists: inserts recoverable `staff_advances` record against driver.
  9. Generates balanced double-entry `journal_entries` and `journal_lines` vouchers.
  10. Transitions trip status to `SETTLED_AND_CLOSED`.

### 3.5 `rpc_reverse_journal_entry`
**Purpose:** Non-destructive financial reversal of an erroneous posted journal entry.
- **Parameters:** `p_entry_id UUID`, `p_reason TEXT`, `p_reversed_by UUID`
- **Atomic Operations:**
  1. Verifies `p_entry_id` is currently in status `POSTED`.
  2. Inserts a new compensating entry into `journal_entries` with status `POSTED` and `reversal_of_entry_id = p_entry_id`.
  3. For every line in the original entry, creates an inverted line in the new entry (debits become credits; credits become debits).
  4. Marks original entry status as `REVERSED` and sets `reversed_by_entry_id = new_entry.id`.
  5. Emits audit log entry.

---

## 4. Idempotency Implementation Pattern

```typescript
// src/modules/delivery/actions/record-delivery-stop.action.ts
import 'server-only';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { ActionResponse } from '@/types/api.types';

const RecordStopSchema = z.object({
  stopId: z.string().uuid(),
  fullJarsDelivered: z.number().int().min(0),
  emptyJarsCollected: z.number().int().min(0),
  amountCollected: z.number().min(0),
  paymentMethod: z.enum(['CASH', 'UPI_QR', 'CHEQUE', 'CREDIT_ACCOUNT']),
  idempotencyKey: z.string().uuid(),
});

export async function recordDeliveryStopAction(
  rawInput: z.infer<typeof RecordStopSchema>
): Promise<ActionResponse<{ stopId: string; status: string }>> {
  // 1. Zod Boundary Validation
  const validated = RecordStopSchema.safeParse(rawInput);
  if (!validated.success) {
    return { 
      success: false, 
      error: 'Invalid delivery stop data', 
      fieldErrors: validated.error.flatten().fieldErrors 
    };
  }

  const supabase = await createServerClient();

  // 2. Call Atomic Database Stored Function
  const { data, error } = await supabase.rpc('rpc_record_delivery_stop', {
    p_stop_id: validated.data.stopId,
    p_full_delivered: validated.data.fullJarsDelivered,
    p_empty_collected: validated.data.emptyJarsCollected,
    p_amount_collected: validated.data.amountCollected,
    p_payment_method: validated.data.paymentMethod,
    p_idempotency_key: validated.data.idempotencyKey,
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data };
}
```
