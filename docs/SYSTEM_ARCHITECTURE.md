# SYSTEM ARCHITECTURE — AquaTrack ERP
**Version 2.1 (Final Approved Architecture)**

---

## 1. Architectural Overview & System Topology

AquaTrack ERP is designed as a modular, cloud-native Enterprise Resource Planning system. It couples the rapid rendering, type safety, and server-side execution of **Next.js App Router (React 19, TypeScript)** with the relational rigor, atomic transactional guarantees, and Row-Level Security (RLS) of **Supabase (PostgreSQL 15+)**.

```
+---------------------------------------------------------------------------------------------------+
|                                         CLIENT TIER                                               |
|                                                                                                   |
|    [ Operations Portal (Desktop) ]     [ Mobile Driver PWA ]       [ Customer Portal (Web/Mobile)]|
|    - Admin, Managers, Accountants      - Delivery Staff & Helpers  - Residential & B2B Clients    |
|    - High-density Data Tables, GL      - One-tap Stoppages, UPI QR - Refill Orders, Jar Balance   |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                            HTTPS / WSS
                                                  │
+---------------------------------------------------------------------------------------------------+
|                                   APPLICATION & LOGIC TIER                                        |
|                                 Next.js 15+ (App Router)                                          |
|                                                                                                   |
|  ┌────────────────────────┐  ┌────────────────────────┐  ┌─────────────────────────────────────┐  |
|  │ Presentation & Shell   │  │ Domain Modules (Core)  │  │ Security & Boundary Validation      │  |
|  │ - Server Components   │  │ - Jar Custody Engine   │  │ - Zod Validation Schemas            │  |
|  │ - Client UI / Forms    │  │ - Route & Trip Engine  │  │ - Next.js Auth Middleware           │  |
|  │ - Tailwind & shadcn/ui │  │ - Cash Reconciliation  │  │ - Role-Based Route Guards (7 Roles) │  |
|  │ - Recharts Analytics   │  │ - Double-Entry Ledger  │  │ - Idempotency Key Processor         │  |
|  │ - Configurable GST     │  │ - Multi-Tenant Scoping │  │ - Server-Only Credential Isolation  │  |
|  └────────────────────────┘  └────────────────────────┘  └─────────────────────────────────────┘  |
|                                                  │                                                |
|                                  Server Actions & Typed RPCs                                      |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                          Connection Pool / SSL
                                                  │
+---------------------------------------------------------------------------------------------------+
|                                   DATA & PERSISTENCE TIER                                         |
|                                    Supabase (PostgreSQL 15+)                                      |
|                                                                                                   |
|  ┌────────────────────────┐  ┌────────────────────────┐  ┌─────────────────────────────────────┐  |
|  │ Relational Storage     │  │ Atomic Stored RPCs     │  │ Security & Assets                   │  |
|  │ - 38 Relational Tables │  │ - rpc_dispatch_trip    │  │ - PostgreSQL Row-Level Security     │  |
|  │ - UUID Primary Keys    │  │ - rpc_settle_trip      │  │ - Supabase Auth (JWT Claims)        │  |
|  │ - Foreign Key Cascades │  │ - rpc_stock_movement   │  │ - Supabase Storage (Receipts/Docs)  │  |
|  │ - Multi-Line GL Checks │  │ - rpc_reverse_journal  │  │ - Immutable Append-Only Logs        │  |
|  │ - Parent Locations     │  │ - rpc_record_stop      │  │ - Idempotency Safeguards            │  |
|  └────────────────────────┘  └────────────────────────┘  └─────────────────────────────────────┘  |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Business-Level Data Isolation (Multi-Tenancy Readiness)

While the initial deployment operates for a single water distribution enterprise, the schema and security architecture are engineered for **zero-rework multi-tenancy**:
- **Canonical Partitioning Key:** `organization_id` functions as `business_id` across all business-owned tables.
- **Tenant Context Resolution:** Every request resolves `get_user_org_id()` from the caller's JWT profile claims.
- **Database-Level Isolation:** Row-Level Security policies append an automatic `WHERE organization_id = get_user_org_id()` filter to all queries.
- **Zero SaaS Overhead in Phase 2:** Complex subscription billing or cross-tenant administration is intentionally omitted, preserving simplicity while guaranteeing tenant data separation.

---

## 3. Location Relationships & Safe Record-Creation Sequence

To eliminate circular foreign key deadlocks while ensuring 100% referential integrity:
- **`locations` is the Parent Entity:** Contains `id`, `organization_id`, `type`, `name`, `address`, and `is_active`.
- **Child Entities Reference Parent Location:** `customers`, `suppliers`, `vehicles`, and `warehouses` each store `location_id UUID NOT NULL UNIQUE REFERENCES locations(id) ON DELETE RESTRICT`.

### Safe Record-Creation Sequence:
When creating a customer, vehicle, warehouse, or supplier:
```
[ Client Action / Form Submission ]
               │
               ▼
   [ Begin Database Transaction ]
               │
               ├─► 1. INSERT INTO locations (organization_id, type, name, ...)
               │      RETURNING id AS location_id;
               │
               ├─► 2. INSERT INTO customers/vehicles/warehouses/suppliers (
               │          organization_id, location_id, ...
               │      );
               │
               ▼
   [ Commit Transaction ]
```
- **Referential Integrity Enforced:** If a user tries to delete a location that holds active stock movements or is linked to an active customer, PostgreSQL aborts with a foreign key violation (`ON DELETE RESTRICT`).
- **Zero Circular Deadlocks:** Because the child table references the parent, records are created cleanly in a standard parent-first sequence without requiring deferred constraint hacks.

---

## 4. Multi-Line Journal Balancing & Reversals

1. **Multi-Line Composition:** A financial transaction can consist of $2, 3, 4\dots N$ line items (e.g., compound entries for sales with separate CGST and SGST outputs, or customer settlements with partial deductions).
2. **Posting Balancing Invariant:**
   - Entries are created in status `'DRAFT'` or posted atomically via stored procedures.
   - A database trigger checks on transition to `'POSTED'`:
     $$\sum \text{debit\_amount} - \sum \text{credit\_amount} = 0.00 \quad \text{AND} \quad \text{line\_count} \ge 2$$
   - Any unbalanced entry is rejected immediately.
3. **Non-Destructive Reversals:** `rpc_reverse_journal_entry` generates a compensating reversal entry with inverted debits and credits, preserving the historical audit trail without mutating posted rows.

---

## 5. Mobile Driver Offline Tolerance & Idempotency Safeguards

1. **Client-Side Queueing:** The driver mobile web PWA stores route stops in browser `IndexedDB`.
2. **UUID v4 Idempotency Key:** When a delivery drop-off is logged, an `idempotency_key` is assigned.
3. **Server Deduplication:** `rpc_record_delivery_stop` checks `idempotency_keys` before executing stock or payment logic. If a retry request is received after network reconnection, the server returns the cached response immediately without re-moving jars or re-posting payments.
4. **Settled Trip Lock:** Any stop modification request on a trip in status `'SETTLED_AND_CLOSED'` is rejected server-side with `TRIP_ALREADY_SETTLED_EXCEPTION`.
