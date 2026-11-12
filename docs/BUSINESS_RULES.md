# BUSINESS RULES & INVARIANTS — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

This document establishes the fundamental, non-negotiable business rules, mathematical invariants, and accounting constraints of AquaTrack ERP. Every database schema, trigger, server action, API endpoint, and UI component must comply with these rules.

---

## 1. Inventory & Jar Conservation Invariants

### Rule 1: Multi-State Asset Classification
Every reusable water jar or dispenser container in the system must belong to exactly one of the following canonical stock states:
1. `FULL_USABLE`: Filled, capped, sealed, quality-inspected, ready for customer dispatch.
2. `EMPTY_CLEAN`: Empty, sanitized, ready for bottling plant refilling.
3. `EMPTY_DIRTY`: Empty jar retrieved from customer route, pending sorting and washing.
4. `DAMAGED_REPAIRABLE`: Dispenser or jar with minor defect pending maintenance.
5. `DAMAGED_SCRAP`: Punctured, cracked neck, or contaminated jar permanently retired from circulation.

### Rule 2: Conservation of Total System Inventory
At any instant in time $t$, the total quantity of company-owned jars must satisfy:
$$\text{Total Business Jars} = Q_{\text{Warehouse}} + Q_{\text{Vehicles/Staff}} + Q_{\text{Customers}} + Q_{\text{Suppliers/Plants}} + Q_{\text{Scrap/Retired}}$$
Jars cannot appear or disappear without an explicit logged transaction (`JAR_PURCHASE`, `JAR_SCRAPPED`, or `PHYSICAL_AUDIT_ADJUSTMENT`).

### Rule 3: Decoupled Full Drop-Off and Empty Collection
- Delivering $N$ full jars does **not** assume, imply, or automatically record $N$ empty jars collected.
- All delivery transactions must accept independent, non-negative integer counters:
  $$\text{Full Delivered} \ge 0, \quad \text{Empty Returned} \ge 0, \quad \text{Damaged Collected} \ge 0$$
- A customer may receive 5 full jars and return 0 empties, or receive 0 full jars and return 8 empties.

### Rule 4: Explicit Custody Transfer Invariant
Physical stock must never exist without an assigned physical custodian:
$$\text{Custodian} \in \{\text{Warehouse}, \text{Staff / Vehicle}, \text{Customer}, \text{Supplier}\}$$
Whenever jars move between parties, the system must atomically decrement the source custodian and increment the destination custodian.

### Rule 5: Atomic Double-Entry Stock Movement
Every stock modification must be recorded in an immutable ledger table (`stock_movements`):
- `source_location_id`
- `destination_location_id`
- `product_id`
- `quantity`
- `condition` (`FULL_USABLE`, `EMPTY_CLEAN`, `EMPTY_DIRTY`, `DAMAGED_REPAIRABLE`, `DAMAGED_SCRAP`)
- `movement_type` (`PURCHASE_RECEIPT`, `DISPATCH_TO_STAFF`, `DELIVERY_TO_CUSTOMER`, `EMPTY_COLLECTION`, `STAFF_RETURN`, `SUPPLIER_REFILL_DISPATCH`, `SCRAP_WRITEOFF`)
- `reference_id`
- `created_by`

---

## 2. Financial & Accounting Invariants

### Rule 6: Sales Revenue vs. Cash Collection Separation
- **Sales Revenue Event:** Occurs when an order is delivered or a POS sale is finalized:
  $$\text{Dr. Accounts Receivable (or Cash with Staff)} \quad / \quad \text{Cr. Sales Revenue}$$
- **Cash Collection Event:** Occurs when payment is remitted for an outstanding invoice:
  $$\text{Dr. Cash in Hand (or Bank Account)} \quad / \quad \text{Cr. Accounts Receivable}$$
- Sales revenue and cash collections must **never** be conflated into a single metric.

### Rule 7: Resale Purchases vs. Operating Expenses
- **Inventory Purchases (Asset Capitalization):** Purchasing bulk water, bottled beverages, empty jars, caps, and dispensers must be capitalized into inventory assets until sold.
- **Operating Expenses:** Fuel, vehicle repairs, facility rent, electricity, packaging consumables, and staff salaries are period expenses that flow directly into profit and loss.
- Resale purchases cannot be booked as operating expenses.

### Rule 8: Reusable Jar Accounting & Deposit Liability
- A customer jar security deposit is **never** company revenue.
- Security deposits must be credited to a balance sheet liability account: `Customer Jar Deposit Liability`.
- Deposits are only converted to income if a customer forfeits their deposit due to lost or unreturned jars.

### Rule 9: Driver Cash Float Isolation
- Cash float given to a driver for change at the start of a trip is an internal asset transfer (`Cash with Staff`), not an expense.
- The morning float must be accounted for during the evening settlement:
  $$\text{Expected Remittance} = \text{Opening Float} + \sum \text{Route Cash Collections} - \sum \text{Approved On-Route Expenses}$$

### Rule 10: Immutability of Posted Transactions
- Posted invoices, completed delivery trip settlements, and financial journal entries are **immutable**.
- They cannot be arbitrarily edited via `UPDATE` or removed via `DELETE`.
- Corrections must be executed via explicit adjustment vouchers, credit notes, or reversal entries.

---

## 3. Customer & Credit Invariants

### Rule 11: Internal Customer Management Only
- Customers are internal business records managed solely by the Owner and authorized staff.
- Customers do not have authentication credentials, login accounts, or self-service portals.
- Customer balances reflect invoiced purchases minus verified payments.

### Rule 12: Credit Limit & Outstanding Balance
- For B2B or credit customers, the system enforces a `credit_limit`.
- Orders exceeding the credit limit trigger an alert requiring Owner authorization.
- Outstanding amount on the customer detail screen is computed strictly from unpaid or partially paid invoices:
  $$\text{Outstanding Balance} = \sum (\text{Invoice Total} - \text{Payments Allocated})$$

---

## 4. Staff Compensation & Expense Rules

### Rule 13: Salary Advances & Deductions
- Staff salary is managed without attendance or leave tracking.
- Advances given to staff during the month are recorded as `Staff Advances` (asset receivables).
- At monthly or agreed settlement:
  $$\text{Net Payout} = \text{Base Salary} - \text{Advances Paid} - \text{Approved Deductions}$$
- Advances must not be double-counted when posting the final salary expense.

### Rule 14: Documented Operating Expenses
- Every expense voucher must specify amount, category, date, payment method, description, and creator.
- Operating expenses directly reduce Net Profit without altering Cost of Goods Sold.
