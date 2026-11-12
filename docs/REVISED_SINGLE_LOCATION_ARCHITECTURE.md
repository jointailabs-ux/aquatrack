# REVISED SINGLE-LOCATION ARCHITECTURE — AquaTrack ERP

**Document Reference:** `docs/REVISED_SINGLE_LOCATION_ARCHITECTURE.md`  
**Version:** 3.0.0 (Single-Location Simplified Architecture)  
**Date:** November 2026  
**Status:** APPROVED ARCHITECTURAL SPECIFICATION  
**Target Environment:** Next.js 15 App Router / Supabase PostgreSQL 15+ / TypeScript Strict  

---

## 1. System Vision & Context

AquaTrack ERP is redesigned as an agile, highly reliable management platform engineered specifically for a **single-location water distribution and packaged beverage business**.

The previous enterprise multi-branch, multi-organization, and customer-facing portal architecture has been completely removed to eliminate unnecessary complexity while preserving enterprise-grade data integrity, accounting precision, and database security.

```
+-----------------------------------------------------------------------------------+
|                     AQUATRACK SINGLE-LOCATION ARCHITECTURE                        |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                             USER ROLES (2 TIERS)                            |  |
|  |  [ OWNER ]                     [ STAFF ]                                    |  |
|  |  - Complete System Access       - Individual Login Credentials              |  |
|  |  - Financial Control & P&L      - Mobile Delivery Execution (Default)       |  |
|  |  - Staff Provisioning           - Modular Permissions: POS, Warehouse, etc. |  |
|  +-----------------------------------------------------------------------------+  |
|                                         │                                         |
|                                         ▼                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                       NEXT.JS 15 APPLICATION FOUNDATION                     |  |
|  |  (App Router, React 19, Tailwind CSS, shadcn/ui, Zod Validation)            |  |
|  |                                                                             |  |
|  |  ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────────────┐  |  |
|  |  │ OWNER DASHBOARD  │ │  STAFF MOBILE    │ │         POINT OF SALE       │  |  |
|  |  │ & ANALYTICS      │ │  DELIVERY PWA    │ │  (Walk-in Beverage Sales)   │  |  |
|  |  └──────────────────┘ └──────────────────┘ └─────────────────────────────┘  |  |
|  |  ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────────────┐  |  |
|  |  │ CUSTOMER LEDGERS │ │ JAR CIRCULATION  │ │   PROCUREMENT & SUPPLIERS   │  |  |
|  |  │ (No Customer Auth│ │ (5 Conditions)   │ │  (Purchases & Payables)     │  |  |
|  |  └──────────────────┘ └──────────────────┘ └─────────────────────────────┘  |  |
|  |  ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────────────┐  |  |
|  |  │ STAFF SALARIES   │ │ EXPENSES ENGINE  │ │    FINANCIAL & TAX REPORTS  │  |  |
|  |  │ (Advances/Payout)│ │ (9 Categories)   │ │  (Sales vs Cash, COGS, P&L) │  |  |
|  |  └──────────────────┘ └──────────────────┘ └─────────────────────────────┘  |  |
|  +-----------------------------------------------------------------------------+  |
|                                         │                                         |
|                                         ▼                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                        SUPABASE POSTGRESQL 15+ ENGINE                       |  |
|  |  - Row-Level Security (RLS) forced across all tables                        |  |
|  |  - search_path-hardened SECURITY DEFINER helper functions & RPCs           |  |
|  |  - Single Central Warehouse & Canonical Custody Locations                   |  |
|  |  - Immutable Stock & Jar Movement Audit Ledger                              |  |
|  |  - Reversible posted financial transactions (Credit Notes / Reversals)      |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Core Subsystems

### 2.1 Jar Custody & Circulation Engine (Highest Priority)
- Reusable jars are capital assets circulating through the business:
  $$\text{Total Jars} = \text{Warehouse} + \text{Staff/Vehicle} + \text{Customer Custody} + \text{Supplier Custody} + \text{Scrapped}$$
- **5 Discrete Conditions:**
  1. `FULL_USABLE`: Water jars filled, sealed, inspected, and ready for dispatch.
  2. `EMPTY_CLEAN`: Clean sanitized empties ready for bottling plant refilling.
  3. `EMPTY_DIRTY`: Empties retrieved from customer routes pending washing.
  4. `DAMAGED_REPAIRABLE`: Jars with repairable minor defects.
  5. `DAMAGED_SCRAP`: Cracked, punctured, or contaminated jars retired permanently.
- **Delivery Invariant:**
  $$\text{Full Delivered} \neq \text{Empty Returned}$$
  Every stop records actual delivered full jars, collected empty jars, and collected damaged jars as separate independent counters.

---

### 2.2 Customer Management (Internal Records Only)
- **Zero Customer Login:** Customers do not authenticate, register, or access any portal.
- **Profiles Managed Internally:** Created and maintained by the Owner or authorized staff (`can_manage_customers = true`).
- **Integrated Customer Detail View:**
  - Customer contact info, address, delivery instructions, custom tier pricing.
  - Delivery history log.
  - Invoiced purchases history.
  - Payment receipts log (Cash, UPI, Cheque).
  - Total purchases, total payments, and **Outstanding Amount** (derived strictly from unpaid invoices).
  - Current jar holdings: Full jars held vs. empty jars held.
  - Jar collection history.

---

### 2.3 Single Warehouse & Inventory Management
- **One Central Warehouse:** Exactly one physical depot storage facility (`is_default = true`).
- **Packaged Beverages:** Auto-decremented on POS sale or order delivery completion.
- **Reusable Water Jars:** Tracked by physical condition and custody location.
- **Stock Movements:** Every stock mutation is recorded in `stock_movements` via atomic database RPCs. Direct client-side updates are revoked.

---

### 2.4 Mobile Delivery Operations
- Owner or staff creates orders manually.
- Delivery trips are dispatched to a specific staff member.
- Responsive mobile web interface for staff:
  - Sequence of customer stops.
  - Touch-optimized inputs for actual delivered quantities, empty jars collected, damaged jars collected, and payment received.
  - Evening check-in reconciling loaded stock against returned stock and cash collections.

---

### 2.5 Point of Sale (POS) — Walk-In Counter Sales
- High-speed counter sales interface for walk-in customers purchasing bottled water, packaged beverages, and 20L refills.
- Features: Product catalog, cart management, discretionary discounts (permission-checked), tax calculation, multi-tender payment (Cash, UPI QR, Card), printable receipt.
- Instantly reduces packaged beverage inventory and records cash inflow.

---

### 2.6 Purchases & Supplier Management
- Supplier directory (bottling plants, packaging vendors).
- Purchase invoice recording (items, costs, applicable GST rates).
- Stock increments **only** upon verified goods receipt (GRN).
- Partial/full supplier payment vouchers and real-time accounts payable (AP).

---

### 2.7 Staff Salary Management (Simplified)
- Completely excludes biometric attendance and leave management.
- Tracks:
  - Base salary amount and payment frequency.
  - Mid-month salary advances.
  - Deductions (e.g. cash shortages, damages).
  - Net payout computation: $\text{Base} - \text{Advances} - \text{Deductions}$.
  - Payment date, payment method, payout history, and remaining unpaid salary balance.
- Payouts integrate into operational expenses without double-counting advances.

---

### 2.8 Expense Recording
- Categorized recording: Fuel, Vehicle Maintenance, Facility Rent, Utilities, Packaging, Cleaning, Repairs, Salary, Miscellaneous.
- Tracks amount, category, date, payment method, description, receipt attachment reference, and creator.

---

### 2.9 Financial Reporting & Managerial Accounting
- Accurately distinguishes:
  - Sales Revenue vs. Cash/UPI Collections.
  - Accounts Receivable (Unpaid Invoices) with aging.
  - Accounts Payable (Supplier Balances).
  - Cost of Goods Sold (COGS).
  - Gross Profit ($\text{Sales} - \text{COGS}$).
  - Operating Expenses (Rent, Fuel, Utilities, Maintenance, Salary).
  - Net Profit ($\text{Gross Profit} - \text{Operating Expenses}$).
  - Customer Deposits (Balance-sheet liability, never booked as revenue).
  - Configurable GST/HSN tax reporting.
