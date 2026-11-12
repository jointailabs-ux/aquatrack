# ARCHITECTURAL DECISION RECORDS (ADR) — AquaTrack ERP
**Version 2.0 (Post-Review & Audited)**

---

## ADR 001: Unified Multi-Custody Location Model for Physical Inventory

- **Status:** APPROVED
- **Context:** Jars and products move between fixed depots, mobile trucks, external bottling plants, customer premises, and scrap areas. Standard ERP designs create separate tables for each storage type, resulting in duplicated stock-tracking logic and complex join queries.
- **Decision:** Implement a canonical polymorphic `locations` table with a `type` discriminator (`WAREHOUSE`, `VEHICLE`, `CUSTOMER`, `SUPPLIER`, `SCRAP_YARD`). Stock balances (`stock_balances`) and stock transfers (`stock_movements`) reference this unified table.
- **Consequences:** 
  - Stock movements between any two entities (e.g. Warehouse -> Truck, or Truck -> Customer) use a single atomic movement function (`rpc_execute_stock_movement`).
  - Simplifies the global asset conservation calculation: $\text{Total Jars} = \sum \text{quantity in } \texttt{stock\_balances} \text{ across all locations}$.
- **Alternatives Considered:** Separate siloed tables for warehouse inventory, van inventory, and customer holdings. Rejected due to redundant logic and high risk of balance desynchronization.

---

## ADR 002: Decoupled Tracking of Full Deliveries and Empty Returns

- **Status:** APPROVED
- **Context:** In the bottled water industry, drivers frequently deliver full jars without receiving an equal number of empties (e.g., customer has not finished previous jars, or is not home).
- **Decision:** Every order stop independently stores two non-negative integer counters: `full_jars_delivered` and `empty_jars_collected`. Deliveries and returns are treated as two independent physical movements.
- **Consequences:** 
  - Prevents erroneous assumptions of 1:1 jar swaps.
  - Customer bottle balances accurately reflect net jar retention.
- **Alternatives Considered:** Net-difference counter (e.g., $+1$ or $-1$). Rejected because it hides total turnover volume and makes physical gate loading audits impossible.

---

## ADR 003: Dual-Ledger Customer Account Structure

- **Status:** APPROVED
- **Context:** Customers have two independent relationships with the business: monetary (money owed for water consumed) and physical (reusable containers held).
- **Decision:** Maintain two distinct ledgers per customer:
  1. **Financial Ledger:** Invoices vs. Payments (`current_balance`).
  2. **Jar Asset Ledger:** Full jars received vs. Empties returned (`total_jars_holding`).
- **Consequences:** 
  - Customer statements clearly distinguish between financial debts and unreturned bottles.
  - Eliminates customer billing disputes.
- **Alternatives Considered:** Bundling jar deposits directly into delivery invoices as line items. Rejected because customer deposits are liabilities, not earned revenue.

---

## ADR 004: Reusable Jar Deposit as Current Liability

- **Status:** APPROVED
- **Context:** When a customer signs up and deposits $200 per jar, treating this money as income inflates top-line revenue and distorts income tax liabilities.
- **Decision:** Security deposits are credited to `Customer Jar Deposit Liability` (Current Liability) on the balance sheet. Deposits are only recognized as income if the customer permanently forfeits the deposit due to broken or lost jars.
- **Consequences:** 
  - Strict compliance with Generally Accepted Accounting Principles (GAAP).
  - Eliminates false profit figures.
- **Alternatives Considered:** Booking deposits as miscellaneous operating revenue. Rejected as fraudulent under corporate accounting standards.

---

## ADR 005: PostgreSQL Stored Functions (RPC) for Atomic Transaction Boundaries

- **Status:** APPROVED
- **Context:** Multi-step operational events (such as trip loading, route drop-offs, and cashier settlement) touch 4–6 tables simultaneously. If an error occurs midway on the server, the database is left corrupted.
- **Decision:** Execute all multi-table mutations inside PostgreSQL stored functions (`rpc_dispatch_delivery_trip`, `rpc_record_delivery_stop`, `rpc_settle_delivery_trip`, `rpc_execute_stock_movement`) with explicit row locks (`SELECT ... FOR UPDATE`).
- **Consequences:** 
  - Guarantees 100% ACID transactional compliance.
  - Server actions become thin, type-safe wrappers around atomic stored functions.
- **Alternatives Considered:** Client-side orchestration via multiple consecutive Supabase SDK calls. Rejected due to extreme vulnerability to partial failure on flaky mobile networks.

---

## ADR 006: Mobile Driver Offline Tolerance via Idempotency Keys

- **Status:** APPROVED
- **Context:** Delivery drivers frequently operate in basement parking structures and fringe rural areas where internet drops during delivery confirmation.
- **Decision:** The driver mobile web app generates a client-side UUID v4 (`idempotency_key`) for every stop submission. When the mobile app reconnects, duplicate submissions with the same key are caught by the `idempotency_keys` table and return the cached response without re-processing stock or payments.
- **Consequences:** 
  - Eliminates duplicate customer charges and double-counted inventory deductions.
  - Delivers a resilient mobile driver experience.
- **Alternatives Considered:** Blocking app operation when offline. Rejected because drivers cannot wait for internet while parked at customer gates.

---

## ADR 007: PostgreSQL Row-Level Security (RLS) for RBAC Data Segregation

- **Status:** APPROVED
- **Context:** The system handles sensitive financial data (P&L, profit margins, staff salaries) alongside operational data used by delivery staff.
- **Decision:** Enforce authorization rules directly in the database using Supabase Row-Level Security (RLS). Delivery drivers are restricted to their assigned route records via policies evaluating `auth.uid()`.
- **Consequences:** 
  - Even if an attacker compromises a frontend route or client-side token, the database engine refuses unauthorized reads or writes.
- **Alternatives Considered:** Application-layer checks only in Next.js code. Rejected because application bugs could inadvertently expose company-wide financial data.

---

## ADR 008: Strict Immutability of Posted Financial and Inventory Transactions

- **Status:** APPROVED
- **Context:** Staff editing or deleting past deliveries, invoices, or journal entries leads to inventory theft, cash embezzlement, and audit failure.
- **Decision:** `stock_movements`, `journal_entries`, `journal_lines`, and `trip_settlements` are immutable. Database triggers block `UPDATE` and `DELETE` queries on these tables. Corrections must be booked as explicit reversal entries or credit notes.
- **Consequences:** 
  - Provides a tamper-evident financial and asset audit trail.
  - Satisfies corporate statutory audit requirements.
- **Alternatives Considered:** Permitting managers to edit rows directly. Rejected due to the risk of untraceable fraud.

---

## ADR 009: Product-Wise Configurable GST & Historical Invoice Snapshotting

- **Status:** APPROVED
- **Context:** Water products carry different tax rates under Indian GST regulations:
  - 20-litre packaged drinking water carries a revised **5% GST** rate (2.5% CGST + 2.5% SGST) under HSN 2201 90 10 (effective 22 September 2025, subject to company accountant verification).
  - Retail packaged bottles under 20 litres carry **18% GST**.
  - Carbonated or flavored beverages carry **28% GST + Compensation Cess**.
  - If a company modifies tax rates later, historical invoices must not change retroactively.
- **Decision:**
  1. Store configurable product-wise tax fields: `hsn_code`, `gst_rate`, `cgst_rate`, `sgst_rate`, `igst_rate`, and `cess_rate` on the `products` table.
  2. Snapshot the applied tax rates, HSN code, and exact calculated tax amounts on `order_items` and `invoice_items` at the moment of invoice posting.
- **Consequences:**
  - Ensures accurate tax invoicing across multi-product distribution (water refills, retail bottles, dispensers, beverages).
  - Historical invoices remain permanently frozen even when tax rates are updated in settings.
- **Alternatives Considered:** Calculating taxes on the fly from current product settings whenever viewing an invoice. Rejected because it corrupts historical invoices if statutory tax rates change.

---

## ADR 010: Non-Destructive Accounting Reversals via Compensating Entries

- **Status:** APPROVED
- **Context:** When an invoice, payment, or settlement is erroneous, editing or deleting posted journal vouchers destroys financial auditability and violates accounting standards.
- **Decision:** Implement `rpc_reverse_journal_entry` which creates a new compensating journal entry with inverted debits and credits, marks the original voucher as `REVERSED`, and cross-references both entries via `reversal_of_entry_id` and `reversed_by_entry_id`.
- **Consequences:**
  - Zero loss of financial history.
  - Complete compliance with statutory corporate audits.
- **Alternatives Considered:** Voiding rows in place by zeroing out amounts. Rejected because it destroys the record of original posting.

---

## ADR 011: Strict Bidirectional Location Integrity for Custody Assets

- **Status:** APPROVED
- **Context:** A generic `reference_id` on the `locations` table lacks foreign key constraints, creating the risk of stock being transferred to orphaned or deleted entity records.
- **Decision:** Replace generic `reference_id` with explicit foreign keys on `locations` (`warehouse_id`, `vehicle_id`, `customer_id`, `supplier_id`) guarded by a check constraint ensuring exactly one reference matches the location `type`. Furthermore, `customers`, `suppliers`, `warehouses`, and `vehicles` each maintain a required foreign key to `locations(id)`.
- **Consequences:**
  - Database-enforced impossibility of orphaned stock locations.
  - Guarantees referential integrity for all stock movements.
- **Alternatives Considered:** Polymorphic string-based table references. Rejected due to lack of native foreign key enforcement in PostgreSQL.
