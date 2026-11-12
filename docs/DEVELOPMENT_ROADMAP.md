# DEVELOPMENT ROADMAP — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## 1. Roadmap Architecture

The development roadmap reflects the simplified, single-location business scope:
- Elimination of multiple branches, branch managers, and multi-organization complexity.
- Elimination of customer authentication, registration, and customer portal.
- Elimination of biometric attendance and leave management.
- Focus on high-priority Jar Tracking across 5 conditions and 4 custodies.
- Streamlined operational workflows: Orders & Mobile Delivery, POS, Purchases, Expenses, Staff Salary, and Financial Reports.

```
[ Phase 1: Business Requirements & Operational Modeling ] (COMPLETED)
     │
     ▼
[ Phase 2: Architecture, Schema & Invariant Specifications ] (COMPLETED)
     │
     ▼
[ Phase 3: Next.js 15 App Shell, Design System & UI Foundations ] (COMPLETED)
     │
     ▼
[ Phase 4A (Revised): Single-Location Master Data & Database Foundation ] (IN PROGRESS)
     │ ├── Profiles (Owner & Staff with Modular Permissions)
     │ ├── Customers (Master Data Only, No Auth, Full/Empty Jar Holdings)
     │ ├── Suppliers (Master Data & Custody)
     │ ├── Single Warehouse & Canonical Custody Locations
     │ ├── Products & Configurable GST/HSN Pricing
     │ └── Inventory Balances & Immutable Jar Movement Ledger
     │
     ▼
[ Phase 4B: Operational Distribution, POS & Procurement ]
     │ ├── Supplier Purchases & Goods Receipts
     │ ├── Customer Orders & Delivery Trip Dispatch
     │ ├── Mobile Staff Delivery Interface (Deliver, Collect Empties, Log Cash/UPI)
     │ └── Point of Sale (POS) for Walk-in Beverage & Water Counter Sales
     │
     ▼
[ Phase 4C: Financials, Staff Compensation & Managerial Reporting ]
     │ ├── Customer Payments & Accounts Receivable (Unpaid Invoices)
     │ ├── Operating Expenses Recording by Category
     │ ├── Staff Salary Management (Advances, Deductions, Payouts)
     │ └── Financial Reports (Sales Revenue, Cash Collections, COGS, Gross & Net Profit)
     │
     ▼
[ Phase 5: End-to-End Verification, Security Audit & Production Deployment ]
```

---

## 2. Phase-by-Phase Deliverables

### Phase 1: Business Requirements & Operational Modeling
- **Status:** COMPLETED.
- **Deliverables:** Core operational workflows, jar tracking invariants, cash reconciliation formulas.

### Phase 2: Architecture & Database Relationships
- **Status:** COMPLETED & REVISED for Single-Location Model.
- **Deliverables:** Architectural specifications, security guidelines, data invariants, and relational integrity.

### Phase 3: Next.js Foundation & UI Shell
- **Status:** COMPLETED.
- **Deliverables:** Next.js 15 App Router, React 19, Tailwind CSS, reusable UI primitives, mobile navigation, dark/light themes.

### Phase 4A (Revised): Single-Location Master Data & Database Foundation
- **Status:** IN PROGRESS.
- **Objectives:**
  - Revised Supabase PostgreSQL migration removing branches, multi-organization overhead, and customer onboarding tokens.
  - Two operational roles (`owner`, `staff`) with modular permission flags (`can_pos`, `can_warehouse`, `can_manage_customers`, `can_manage_orders`).
  - Customer master management with no customer login (tracking contact, address, tier pricing, unpaid invoice balance, and full/empty jar holdings).
  - Single warehouse and canonical locations (Warehouse, Staff/Vehicle, Customer, Supplier, Scrap Yard).
  - Products catalog supporting refillable water, packaged water, beverages, and dispensers with configurable GST rates.
  - Jar condition ledger (`FULL_USABLE`, `EMPTY_CLEAN`, `EMPTY_DIRTY`, `DAMAGED_REPAIRABLE`, `DAMAGED_SCRAP`).
  - Hardened RLS policies and search_path-isolated helper functions.
  - Owner provisioning script and authenticated multi-scenario test suite.

### Phase 4B: Operational Distribution, POS & Procurement
- **Objectives:**
  - Supplier procurement bills, partial/full payments, and goods receipt verification.
  - Manual customer order creation and route assignment.
  - Mobile-optimized driver interface for stop completion, actual delivery quantities, empty/damaged jar collection, and cash/UPI receipt recording.
  - Point of Sale (POS) counter sales with real-time stock deduction for packaged beverages.

### Phase 4C: Financials, Staff Compensation & Managerial Reporting
- **Objectives:**
  - Accounts receivable tracking derived from unpaid invoices.
  - Staff salary management (base salary, advances, deductions, payout history).
  - Expense recording across 9 operational categories.
  - Executive financial reports distinguishing sales revenue from cash collections, deposits, and operating profit.

### Phase 5: Production Hardening & Deployment
- **Objectives:**
  - End-to-end integration verification across all operational journeys.
  - Zero-write database audit and final sign-off before production migration.
