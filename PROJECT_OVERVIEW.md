# PROJECT OVERVIEW — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## 1. Executive Summary

**AquaTrack ERP** is an agile, robust, cloud-native Enterprise Resource Planning system specifically engineered for a single-location commercial water distribution and packaged beverage business.

Water distribution operations are fundamentally distinct from standard retail or e-commerce because they depend on **reusable high-value physical assets (20-liter polycarbonate/PET jars, 10-liter containers)** that circulate continuously between the business's central warehouse, delivery staff vehicles, customer sites, and refilling suppliers.

AquaTrack ERP eliminates generic ERP overhead and multi-branch complexity, providing streamlined control over:
- Full vs. empty jar custody and condition tracking (`FULL_USABLE`, `EMPTY_CLEAN`, `EMPTY_DIRTY`, `DAMAGED_REPAIRABLE`, `DAMAGED_SCRAP`).
- Mobile-friendly delivery dispatch and driver check-in.
- Point-of-Sale (POS) for walk-in beverage and water sales.
- Procurement and supplier invoice management.
- Accurate customer transaction ledgers and outstanding payment tracking (without requiring customer login).
- Simple staff salary tracking and operational expense recording.
- Managerial accounting distinguishing sales revenue from cash collections, deposits, and operating profit.

---

## 2. Business Model & Operational Scope

The business operates as a **single-location enterprise**:
- **One Owner:** Full executive oversight and unrestricted operational authority.
- **Flexible Staff:** Mobile delivery drivers, warehouse staff, and sales operators with individualized credentials and role-based permissions.
- **One Central Warehouse:** Physical storage for water jars, packaged beverages, and equipment.
- **Zero Branches:** No branch hierarchy, no multi-organization switching, and no distributed branch reporting.
- **No Customer Authentication:** Customers are strictly master-data entities managed by the owner and authorized staff. There is no customer portal, registration, or customer login.
- **Fleet-Based Distribution:** 2–5 delivery vehicles distributing 300 to 1,000+ jars daily to residential (B2C) and commercial/institutional (B2B) clients.

```
+-----------------------------------------------------------------------------------+
|                        AQUATRACK SINGLE-LOCATION LIFECYCLE                        |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [ SUPPLIERS / BOTTLING PLANTS ]                                                  |
|       ^               |                                                           |
|       | Send Empties  | 1. Purchase Water Jars & Beverages (GRN / Bill)           |
|       | for Refill    v                                                           |
|  +-------------------------------------+                                          |
|  |       SINGLE CENTRAL WAREHOUSE      |                                          |
|  +-------------------------------------+                                          |
|       |                                |                                          |
|       | 2. Morning Dispatch            | POS Walk-in Sales (Packaged Beverages)   |
|       v                                v                                          |
|  [ DELIVERY STAFF & VEHICLES ]     [ WALK-IN CUSTOMERS (Cash / UPI) ]             |
|       |                                                                           |
|       | 3. Route Delivery & Empty Collection (Mobile Staff Web Interface)        |
|       v                                                                           |
|  [ CUSTOMERS (B2C & B2B) ]                                                        |
|  (Deliver Full Jars, Collect Empties, Log Cash/UPI Payments)                      |
|       |                                                                           |
|       | 4. Evening Check-In & Settlement (Stock & Cash Return)                    |
|       v                                                                           |
|  [ OWNER DASHBOARD & FINANCIAL REPORTS ]                                          |
|  (Daily Reconciliation, AR Aging, Expenses, Salaries, Profit & Loss)              |
+-----------------------------------------------------------------------------------+
```

---

## 3. Two Core User Categories

### 3.1 Owner
The Owner holds complete access to all system capabilities:
- Executive analytics dashboard & cash-flow overview.
- Staff user management, credential generation, and module permission assignment.
- Customer management (profile, pricing, ledger, full/empty jar holdings).
- Supplier directory, purchase orders, goods receipts, and vendor payments.
- Single warehouse inventory management and jar condition balances.
- Order creation, route scheduling, and delivery trip assignment.
- Walk-in Point-of-Sale (POS) and sales receipt generation.
- Operational expenses recording and category management.
- Staff salary management (base pay, advances, deductions, payouts).
- Financial reports (P&L, COGS, Cash Flow, Customer AR, Tax summaries).
- System settings and tax/HSN configuration.

### 3.2 Staff
Staff members receive individual login accounts. Permissions are assigned modularly by the Owner:
- **Delivery Workflow (Standard):**
  - View assigned orders and delivery route.
  - View customer name, phone, address, and delivery notes.
  - Record actual delivered quantities, empty jars collected, and damaged jars.
  - Record customer cash or UPI payments collected at delivery.
  - Mark deliveries completed or log failed delivery reasons.
  - View personal delivery history and daily route summary.
- **Additional Staff Permissions (Configured by Owner):**
  - POS walk-in sales access.
  - Warehouse stock inspection and jar sorting access.
  - Customer order creation.

---

## 4. Key Architectural Invariants

1. **Full Jar ≠ Empty Jar:** Delivering $N$ full jars to a customer does not automatically mean $N$ empty jars are returned. Full drops and empty collections are tracked independently.
2. **Conservation of Reusable Jar Assets:**
   $$\text{Total Business Jars} = \text{Warehouse Jars} + \text{Staff/Vehicle Jars} + \text{Customer Custody} + \text{Supplier/Plant Custody} + \text{Damaged/Scrapped}$$
3. **Single Warehouse Simplicity:** All internal stock is held at or dispatched from one central warehouse. No inter-branch transfers or multi-warehouse synchronization.
4. **Sales ≠ Collections:** Delivering an order creates an invoice/receivable. Collecting cash/UPI clears the receivable. They are distinct accounting events.
5. **Purchases ≠ Operating Expenses:** Water and bottle purchases are capitalized inventory until sold (COGS). Operating expenses (fuel, rent, maintenance, salary) are period expenses.
6. **No Direct Inventory Modification:** Inventory balances cannot be edited arbitrarily via client-side code; all balance mutations occur through audited database transactions/RPCs.
7. **Security Baseline:** Row-Level Security (RLS) is strictly enforced in Supabase PostgreSQL, separating Owner administrative capabilities from restricted Staff workflows.

---

## 5. Technology Stack

- **Frontend & Server Framework:** Next.js 15 App Router (React 19, TypeScript strict mode).
- **Styling & UI:** Tailwind CSS, Lucide React icons, shadcn/ui components.
- **Backend & Database:** Supabase PostgreSQL 15+, Supabase Auth, Storage.
- **Data Validation:** Zod schemas on all client-server boundaries.
- **Testing:** Vitest for accounting and inventory calculations; Playwright for critical delivery and POS user journeys.
