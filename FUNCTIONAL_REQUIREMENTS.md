# FUNCTIONAL REQUIREMENTS — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## 1. Single Warehouse & Inventory Engine

AquaTrack ERP maintains one central physical warehouse. Client-side code never modifies inventory balances directly; all stock mutations execute via atomic database RPCs.

### 1.1 Product Stock Tracking
The warehouse tracks both liquid/packaged goods and physical container assets:
- **Packaged Beverages & Packaged Water (Non-Returnable):**
  - Tracked as standard inventory units.
  - Automatically decremented upon POS sale completion or order delivery.
  - Incremented upon goods receipt note (GRN) from suppliers.
- **Reusable Containers (20L / 10L Jars):**
  - Tracked independently across 5 conditions:
    1. `FULL_USABLE`: Water jars filled, sealed, and ready for dispatch.
    2. `EMPTY_CLEAN`: Sanitized empty jars ready for plant dispatch / refilling.
    3. `EMPTY_DIRTY`: Empties returned from delivery routes awaiting inspection/washing.
    4. `DAMAGED_REPAIRABLE`: Jars with minor neck or valve defects pending maintenance.
    5. `DAMAGED_SCRAP`: Punctured, contaminated, or cracked jars permanently retired.

### 1.2 Custody Tracking
Every reusable container in the business resides in one of four custodies:
1. **Warehouse:** Central depot holding bins.
2. **Staff / Delivery Vehicle:** Mobile in-transit custody assigned to a specific driver.
3. **Customers:** Jars placed at customer premises.
4. **Supplier / Plant:** Empty jars sent to bottling plants for bulk refilling.

---

## 2. Customer Management (Internal Only — No Customer Login)

Customers are managed exclusively by the owner and authorized staff.

### 2.1 Customer Profiles
- Name, contact phone, delivery address, customer type (`B2C` or `B2B`).
- Delivery instructions (e.g., gate code, floor number, drop location).
- Custom pricing per product (if negotiated tier pricing applies).
- Operational notes.

### 2.2 Customer Detail Dashboard
Each customer profile presents an integrated operational view:
1. **Customer Overview:** Profile information, phone, address, pricing rules.
2. **Delivery History:** Reverse-chronological log of all orders, trip dates, delivering staff, and status.
3. **Purchase & Invoice History:** Invoices generated, items purchased, tax applied, invoice balance.
4. **Payment Receipts:** Chronological list of payments received (Cash / UPI / Cheque).
5. **Financial Totals:** Total invoiced purchases, total payments recorded, and real-time **Outstanding Amount** (derived strictly from unpaid invoices).
6. **Jar Holdings:**
   - Current full jars held.
   - Current empty jars held.
   - Total jar holding.
   - Refundable jar deposits held.
7. **Jar Collection History:** Detailed log of empty and damaged jars collected across past deliveries.

---

## 3. Jar Tracking & Circulation Engine (Highest Priority)

### 3.1 Jar Movement Invariant
$$\text{Full Jars Delivered} \neq \text{Empty Jars Returned}$$
Every delivery transaction captures full jars delivered, empty jars collected, and damaged jars collected as independent values.

### 3.2 Dual Custody Ledger
When a delivery of $F$ full jars occurs with $E$ empties and $D$ damaged collected:
- **Vehicle Custody:** Decrements `FULL_USABLE` by $F$; increments `EMPTY_DIRTY` by $E$; increments `DAMAGED_SCRAP` by $D$.
- **Customer Custody:** Increments full jar holding by $F$; decrements empty jar holding by $E + D$.
- **Customer Net Jars Holding:**
  $$\text{New Holding} = \text{Old Holding} + F - (E + D)$$

### 3.3 System-Wide Circulation Audit
The management dashboard continuously computes:
- Total jars in warehouse (by condition).
- Total jars with each staff member/vehicle.
- Total jars in customer custody.
- Total jars at supplier refilling plants.
- Total jars retired/scrapped.
- Circulation total matching global enterprise jar inventory.

---

## 4. Delivery Operations & Driver Interface

### 4.1 Order & Dispatch Lifecycle
1. **Order Creation:** Created manually by owner or authorized staff (`PENDING` / `CONFIRMED`).
2. **Assignment:** Assigned to a specific staff member and delivery trip (`ASSIGNED`).
3. **Dispatch:** Vehicle departs warehouse with verified full stock (`OUT_FOR_DELIVERY`).
4. **Mobile Delivery Execution:**
   - Driver opens mobile web interface (responsive, high-contrast, touch-optimized).
   - Driver selects customer stop.
   - Driver records:
     - Actual quantity delivered.
     - Empty clean/dirty jars collected.
     - Damaged jars collected.
     - Cash or UPI payment collected.
     - Operational delivery notes (or failed delivery reason).
   - Driver marks stop `DELIVERED` or `PARTIALLY_DELIVERED`.
5. **Evening Check-In & Settlement:**
   - Warehouse inspects returned full jars, returned empties, and damaged jars.
   - Cashier/Owner reconciles cash collected against:
     $$\text{Expected Cash} = \text{Opening Float} + \sum \text{Route Cash Collections} - \sum \text{Approved On-Route Expenses}$$

---

## 5. Point of Sale (POS) — Walk-In Sales

### 5.1 Counter Operations
- Optimized for quick walk-in customer sales of bottled water, beverages, and walk-in jar refills.
- Features:
  - Product catalog search and category filtering.
  - Fast cart item additions with quantity increments.
  - Discretionary item or cart discount (restricted to authorized staff/owner).
  - Configurable tax calculation.
  - Multi-method tender: Cash, UPI QR, Card.
  - Printable/sharable digital receipt.
- **Automatic Inventory Depletion:**
  - Packaged beverage stock decrements instantly upon sale completion.
  - Walk-in 20L refill sales record empty jar collection and full jar handover.

---

## 6. Purchases & Supplier Management

### 6.1 Procurement Lifecycle
- **Supplier Directory:** Contact details, tax ID/GSTIN, payment terms.
- **Purchase Invoices:**
  - Itemized lines (water refills, beverage cases, caps, seals, equipment).
  - Quantity ordered vs. actual quantity received.
  - Unit purchase costs and applicable GST rates.
  - Supplier invoice number and bill date.
- **Stock Increment Invariant:** Stock increments in the warehouse **only** upon explicit goods receipt verification.
- **Payables Management:**
  - Distinct tracking of purchase bill value vs. payment remittances.
  - Partial or full payment vouchers recorded against supplier invoices.
  - Supplier outstanding balance tracked in real time.

---

## 7. Staff Salary Management (Simplified)

Attendance and leave tracking are completely excluded. The salary module provides clean financial compensation tracking:
- **Staff Compensation Profile:**
  - Base salary amount.
  - Salary type (Monthly / Agreed Fixed Period).
- **Advance Payments:** Log salary advances paid to staff during the month.
- **Deductions:** Record approved deductions (e.g., driver cash shortages, damaged equipment deductions).
- **Monthly Settlement / Payout:**
  - Compute net payout: $\text{Base Salary} - \text{Advances} - \text{Deductions}$.
  - Record payment date, payment method, and amount paid.
  - Track remaining unpaid salary balance.
  - Payout history with complete audit log.
- **Financial Integration:** Salary payouts flow into operating expenses without double-counting advances.

---

## 8. Expense Management

- **Expense Categories:**
  - Fuel
  - Vehicle Maintenance & Repairs
  - Facility Rent
  - Electricity & Water Utilities
  - Packaging (Caps, Seals, Film)
  - Cleaning & Sanitization
  - Equipment Repairs
  - Staff Salary
  - Miscellaneous Administrative Expenses
- **Fields:** Expense ID, date, category, amount, payment method (Cash / Bank / UPI), description, receipt attachment link, created by, posting status.

---

## 9. Financial Calculations & Reports

The platform maintains reliable financial reporting:
1. **Sales Revenue:** Accrued upon invoice generation or POS sale.
2. **Collections:** Physical cash or UPI received (reduces accounts receivable).
3. **Accounts Receivable (AR):** Total unpaid invoices with 30/60/90-day aging.
4. **Accounts Payable (AP):** Total unpaid supplier bills.
5. **Cost of Goods Sold (COGS):** Water procurement costs, caps, seals, beverage wholesale costs.
6. **Gross Profit:** $\text{Sales Revenue} - \text{COGS}$.
7. **Net Profit:** $\text{Gross Profit} - \text{Operating Expenses} - \text{Staff Salaries}$.
8. **Customer Deposits (Liabilities):** Security deposits held for jars/dispensers are treated as balance-sheet liabilities, never operational revenue.
9. **Tax Reporting:** Summary of collected GST (CGST + SGST or IGST) based on product-wise configured tax rates.
