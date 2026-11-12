# BUSINESS REQUIREMENTS — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## 1. Business Profile & Operating Scale

AquaTrack ERP is engineered for a single-location water distribution and bottling enterprise operating a fleet-based route delivery and walk-in sales model.

### Key Operating Parameters:
- **Location Structure:** Single central operating facility comprising management office, inventory storage, vehicle loading bay, and bottle sanitization/sorting area.
- **Warehouse:** Exactly ONE warehouse location. No sub-depots, no secondary branches, and no inter-branch transfers.
- **Workforce:**
  - **1 Owner:** Principal administrator with total access.
  - **Flexible Staff:** Delivery drivers, warehouse loaders, and POS cashiers with individualized logins and modular permissions.
- **Product Portfolio:**
  - 20L & 10L reusable water jars (purified packaged drinking water).
  - Packaged non-returnable beverages (500ml, 1L bottles, soda, packaged drinks).
  - Dispenser equipment & manual pumps.
- **Customers:** Residential (B2C) and commercial/corporate (B2B) accounts managed entirely by internal staff. **Zero customer login or customer portal.**
- **Suppliers:** Bottling purification plants, jar manufacturers, cap/seal suppliers, and dispenser vendors.
- **Daily Volume:** 300 to 1,000+ water jars delivered per day across 2–5 delivery routes.

---

## 2. Core Functional Modules

### 2.1 Customer Management (No Customer Login)
Customers are managed exclusively by the owner and authorized staff:
- **Customer Profiles:** Contact name, phone, delivery address, customer type (B2C / B2B), delivery instructions, custom product pricing rules, and operational notes.
- **Customer Detail Screen:**
  - Comprehensive customer profile details.
  - Complete delivery history.
  - Invoiced purchases history.
  - Payment records (cash/UPI receipts).
  - Total purchases and total payments recorded.
  - Outstanding balance derived from unpaid invoices (supporting credit sales for B2B).
  - Current jar holdings: Full jars held vs. empty jars held.
  - Historical jar collection log.

---

### 2.2 Jar Tracking — Highest Business Priority
Tracking reusable containers is fundamental to operational profitability and asset preservation:
- **Separation of Liquid Product and Reusable Asset:** Water volume is an inventory sale; the 20L container is a circulating capital asset.
- **5 Discrete Jar Conditions:**
  1. `FULL_USABLE` (Filled, capped, sealed, quality-inspected, ready for dispatch).
  2. `EMPTY_CLEAN` (Sanitized empty jars ready for plant dispatch / refilling).
  3. `EMPTY_DIRTY` (Returned from customer routes, awaiting washing/inspection).
  4. `DAMAGED_REPAIRABLE` (Minor valve/neck damage pending repair).
  5. `DAMAGED_SCRAP` (Cracked, punctured, or contaminated jars retired from circulation).
- **4 Real-Time Custody Locations:**
  1. **Warehouse** (On-site storage bays).
  2. **Delivery Staff / Vehicle** (In-transit custody during daily delivery trips).
  3. **Customers** (Holding at residential or commercial premises).
  4. **Supplier / Bottling Plant** (Empties sent for refilling).
- **Core Business Invariant:**
  $$\text{Full Jars Delivered} \neq \text{Empty Jars Returned}$$
  Every jar movement is recorded in an immutable movement ledger with dual-entry source and destination locations.

---

### 2.3 Inventory Management (Single Warehouse)
- **Warehouse Stock Ledger:**
  - Opening stock.
  - Purchases received & accepted.
  - Sales & walk-in POS deductions.
  - Delivery dispatch to staff.
  - Route returns & undelivered stock check-in.
  - Damaged stock adjustments.
  - Periodic physical count reconciliations.
  - Closing stock balances.
- **Packaged Beverages vs. Reusable Jars:**
  - Packaged beverages automatically decrement warehouse stock upon POS sale or delivery finalization.
  - Reusable jars update physical condition counts and custody ledgers atomically.
- **Security Invariant:** Client-side code is strictly prohibited from mutating inventory balances directly. All stock movements execute via transactional database RPCs.

---

### 2.4 Purchases & Supplier Management
- **Supplier Directory:** Plant details, contacts, tax/GSTIN, payment terms.
- **Purchase Entries:**
  - Purchase order / entry recording items, unit costs, received quantities, and applicable product-specific tax.
  - Stock increments **only** upon explicit goods receipt and inspection.
  - Supplier invoices and partial/full payment vouchers recorded distinctly.
  - Real-time supplier outstanding payables ledger.

---

### 2.5 Orders & Delivery Operations
- **Order Creation:** Created manually by owner or authorized staff (phone, WhatsApp, recurring schedule).
- **Statuses:** `PENDING`, `CONFIRMED`, `ASSIGNED`, `OUT_FOR_DELIVERY`, `PARTIALLY_DELIVERED`, `DELIVERED`, `CANCELLED`.
- **Mobile-Optimized Staff Interface:**
  - Drivers view assigned trip stops, customer address, and phone.
  - At point of delivery, staff logs:
    1. Actual full jars/beverages delivered.
    2. Empty jars collected.
    3. Damaged jars collected.
    4. Amount collected (Cash / UPI / Cheque).
    5. Delivery notes / failure reason (e.g., door locked).
- **Trip Settlement:** Evening reconciliation matching loaded stock against delivered stock, returned full jars, collected empties, and collected cash/UPI receipts.

---

### 2.6 Point of Sale (POS) & Walk-In Sales
- Simple, high-speed POS interface for counter sales (packaged water, beverages, walk-in 20L refills).
- Product search, category filtering, cart management.
- Discretionary discounts restricted by permission.
- Flexible payment methods: Cash, UPI, Card.
- Instant receipt printing / digital sharing.
- Automatic inventory depletion for packaged goods and jar custody logging for refill sales.

---

### 2.7 Staff Salary Management (Simplified)
Explicitly replaces complex HR, leave, and biometric attendance modules:
- Staff salary configuration (base amount, monthly/weekly frequency).
- Advance salary payments tracking.
- Operational or performance deductions.
- Payment recording (date, amount paid, payment method, balance remaining).
- Historical staff payout ledger.
- Salary expenses flow cleanly into managerial financial reports without double-counting.

---

### 2.8 Expense Tracking
- Expense categorization: Fuel, Vehicle Maintenance, Rent, Electricity, Cleaning & Sanitization, Bottle Caps & Seals, Machinery Repairs, Staff Salary, Miscellaneous.
- Fields: Amount, category, date, payment method, description, receipt attachment reference, created by.
- Real-time impact on net profit and operational cash flow.

---

### 2.9 Financial Reporting & Managerial Accounting
The system enforces strict accounting discipline:
- **Sales Revenue:** Earned upon order delivery or POS invoice generation.
- **Cash / UPI Collections:** Realized upon payment receipt (satisfies accounts receivable).
- **Unpaid Invoices:** Transparent Accounts Receivable (AR) aging.
- **Cost of Goods Sold (COGS):** Water procurement cost, bottle caps, seals, and amortized container replacement.
- **Gross Profit:** Sales Revenue minus COGS.
- **Net Profit:** Gross Profit minus Operating Expenses (Rent, Fuel, Maintenance, Salaries, Utilities).
- **Customer Deposits:** Refundable jar security deposits tracked as liabilities, never recognized as revenue.
- **Configurable Taxes:** Product-specific HSN codes and GST rates (e.g., 5% on 20L packaged drinking water, 18% or 28% on beverages/equipment) permanently stamped on posted invoices.
