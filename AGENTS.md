# AGENTS.md — AquaTrack ERP Development & Security Standards

Welcome to the **AquaTrack ERP** codebase. This document defines permanent instructions, development rules, architectural standards, and security mandates for all AI coding agents and developers working on this project.

---

## 1. Project Vision & Identity

AquaTrack ERP is a full-featured, enterprise-grade enterprise resource planning platform engineered specifically for the water distribution and bottling industry.

The business operates a fleet-based route delivery model:
1. Purchasing / procuring purified water (and packaged bottles/dispensers/accessories) from bottling plants and suppliers.
2. Managing reusable containers (20L polycarbonate / PET jars, 10L jars) with strict empty-vs-full custody accounting.
3. Distributing to residential (B2C) and commercial/institutional (B2B) customers through dedicated delivery routes and staff (initially 2–3 delivery drivers, architected to scale to 50+).
4. Providing full-cycle business automation: Order dispatch, mobile driver route management, empty jar reconciliation, cash/UPI collections, accounts receivable/payable, expense tracking, payroll, vehicle maintenance, and managerial accounting.

---

## 2. Core Architectural & Engineering Principles

### 2.1 Technology Stack Standards
- **Framework:** Next.js App Router (React 19 / Server Components + Client Components where interactivity is required).
- **Language:** TypeScript with strict type checking enabled (`strict: true`, `noImplicitAny: true`).
- **Styling & UI:** Tailwind CSS + shadcn/ui components. High-end modern aesthetics (dark/light themes, sleek typography, micro-interactions, responsive mobile views for delivery drivers).
- **Backend & Database:** Supabase (PostgreSQL 15+), Supabase Auth, Supabase Storage.
- **Data Validation:** Zod schemas for all client and server boundary validations (API payloads, Server Actions, form submissions).
- **Form Management:** React Hook Form with `@hookform/resolvers/zod`.
- **Charts & Visualizations:** Recharts for operational and financial dashboards.
- **Testing:**
  - **Vitest** for unit and integration testing of business logic, accounting calculations, and reconciliation algorithms.
  - **Playwright** for end-to-end user journey testing (order lifecycle, delivery trip reconciliation, invoicing).

### 2.2 Phase-by-Phase Discipline
- Work strictly in designated phases. **Never jump ahead to write application code or database migrations before prior architectural phases are reviewed and approved.**
- Maintain documentation in `/docs` continuously. Any change in business logic or data models must be reflected in the documentation immediately.

---

## 3. Strict Business Invariants (Never Violate)

Every AI agent and engineer must adhere to these foundational business laws:

### 3.1 Jar Custody & Physical Tracking
1. **Full Jar ≠ Empty Jar:** Delivering $N$ full jars to a customer does **never** automatically mean $N$ empty jars are returned. Full jars dropped and empty jars collected must be tracked as two independent integer variables.
2. **Conservation of Assets:** Every reusable jar in existence must be in exactly one known custody at any point in time:
   $$\text{Total System Jars} = \text{Warehouse Stock} + \text{Vehicle/Route Stock} + \text{Customer Custody} + \text{Supplier/Plant Custody} + \text{Scrapped/Lost Jars}$$
3. **Atomic Stock Movements:** Stock never "disappears" or "appears". Every physical movement must have a corresponding dual-entry transaction record (`source_location_id`, `destination_location_id`, `product_id`, `quantity`, `movement_type`, `created_by`).

### 3.2 Financial & Accounting Integrity
1. **Sales ≠ Collections:** Delivering an order generates an invoice (Accounts Receivable & Sales Revenue). Collecting cash or UPI payment satisfies Accounts Receivable (Cash/Bank & Accounts Receivable). They must never be merged into a single event.
2. **Purchases ≠ Expenses:** Purchasing resale inventory (water jars, dispensers) is an asset capitalization until sold (Cost of Goods Sold). Operational expenses (fuel, vehicle repairs, tea/meals, rent) are period expenses.
3. **Driver Cash Float Isolation:** Morning cash given to a driver for change is an asset transfer (`Cash with Driver`), not an expense. Evening cash settlement reconciles:
   $$\text{Expected Cash} = \text{Opening Float} + \text{Route Cash Collections} - \text{Approved On-Route Expenses}$$
4. **Immutability of Posted Transactions:** Once a financial journal entry, finalized invoice, or approved delivery trip is posted, it **cannot be edited or deleted**. Corrections must be made via reversal entries, credit notes, or explicit adjustment vouchers.

---

## 4. Strict Security & Credential Rules

### 4.1 Zero-Leakage Credential Mandate
- **NEVER** hardcode credentials, connection strings, or secret API keys in any code file, test script, or documentation.
- **NEVER** print, echo, or log secret keys (`SUPABASE_SECRET_KEY`, `DATABASE_URL`, passwords) in terminal output, agent logs, or commit messages.
- **NEVER** expose `SUPABASE_SECRET_KEY` or `DATABASE_URL` to browser clients. Only client-safe keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) may use the `NEXT_PUBLIC_` prefix.
- Ensure `.env.local` is permanently listed in `.gitignore`.
- Provide only placeholder values in `.env.example`.
- Never ask the user to paste credentials into the AI conversation prompt. Instruct them to populate `.env.local` privately.

### 4.2 Row-Level Security (RLS) & Access Control
- Every table created in PostgreSQL **must** have Row-Level Security (RLS) enabled.
- Delivery staff must only see their own assigned trips, customers on their route, and vehicle inventory.
- Warehouse staff can view warehouse inventory and dispatch sheets, but cannot view company-wide financial P&L.
- Only Admins and Accountants can access financial ledgers, salary data, and profit reports.
- Comprehensive audit logs (`audit_logs` table) must capture the user ID, timestamp, IP address, previous state, and new state for all critical operations.

---

## 5. Development Workflow Guidelines

### 5.1 Code Organization (App Router)
```
src/
├── app/                  # Next.js App Router pages and route handlers
│   ├── (auth)/           # Authentication routes (login, forgot-password)
│   ├── (dashboard)/      # Authenticated ERP modules
│   └── api/              # Secure API route handlers
├── components/           # Reusable UI & domain components
│   ├── ui/               # shadcn/ui primitives
│   ├── forms/            # React Hook Form domain forms
│   └── layout/           # Sidebar, header, navigation, shell
├── lib/                  # Infrastructure & core clients
│   ├── supabase/         # Supabase client (client.ts, server.ts, admin.ts)
│   └── utils.ts          # Formatting, math, and utility helpers
├── modules/              # Domain-driven modular business logic
│   ├── customers/
│   ├── delivery/
│   ├── inventory/
│   ├── jars/
│   └── accounting/
├── types/                # Shared TypeScript definitions & database schemas
└── tests/                # Vitest unit/integration & Playwright E2E suites
```

### 5.2 Verification Before Acceptance
- All calculations (jar balances, tax computations, driver cash settlement balances) must have automated Vitest unit tests with 100% coverage of edge cases.
- Every user journey must be verified end-to-end before declaring a phase complete.
