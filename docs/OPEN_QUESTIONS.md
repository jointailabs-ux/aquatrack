# OPEN BUSINESS QUESTIONS & ARCHITECTURAL DECISIONS — AquaTrack ERP

To ensure AquaTrack ERP reflects your exact operational reality, the following strategic questions require your confirmation. For each question, an industry-standard recommendation and its impact on the database schema and business logic are provided.

---

### Question 1: Jar Deposit & Custody Model
- **Context:** Reusable 20L containers represent significant capital. Customers frequently fail to return bottles if not financially incentivized.
- **Options:**
  - *Option A (Recommended):* Hybrid Model. B2C residential customers pay a refundable deposit ($150–$250/jar) recorded in a liability ledger. B2B corporate clients operate on an asset-loan contract with a maximum jar holding limit and no cash deposit.
  - *Option B:* Outright Sale Model. Customers buy the empty bottle once. Delivered water is a refill exchange.
  - *Option C:* Pure 1:1 Swap. No deposit; customer must give an empty jar to get a full jar (problematic for new customers or when drivers arrive and customer is out of empties).
- **Default Recommendation:** Option A.
- **Database & Architecture Impact:** Creates a `customer_deposit_ledgers` table and adds `max_jar_holding_limit` to `customers`.

---

### Question 2: Water Sourcing & Bottling Setup
- **Context:** How the business procures filled water jars impacts inventory and purchase workflows.
- **Options:**
  - *Option A (Recommended):* External Bottling Plant Supplier. The business owns empty jars, transports them in batches to a supplier's RO bottling plant for filling, pays a per-jar refill fee, and retrieves filled jars.
  - *Option B:* In-House RO Water Purification Plant. The business operates its own filtration machinery, tracking electricity, water extraction, filter membranes, and labor as raw material inputs.
  - *Option C:* Hybrid. In-house plant supplemented with external bulk purchases during peak summer demand.
- **Default Recommendation:** Option A (with extensible design to accommodate Option B/C).
- **Database & Architecture Impact:** Implements a specialized `supplier_jar_custody` ledger tracking empty jars in transit to and from third-party plants.

---

### Question 3: Jar Tracking Granularity (Batch Counts vs. Barcode/RFID Serialization)
- **Context:** How granularly should individual 20L bottles be tracked?
- **Options:**
  - *Option A (Recommended for 2–3 Drivers):* Quantity-Based Custody Ledger. Jars are tracked as aggregate integer counts per location/customer. Jars are fast-moving, high-friction items; drivers delivering 50 jars to an office cannot scan 50 individual barcodes in the rain/heat.
  - *Option B:* Barcode / QR Code Serialization. Every single bottle has a waterproof barcode sticker scanned at every touchpoint.
  - *Option C:* Hybrid. Batch tracking for standard jars, serialized tracking for expensive water dispensers and electric pumps.
- **Default Recommendation:** Option C (Batch counts for jars, unique serial numbers for dispensers).
- **Database & Architecture Impact:** Jars tracked via `stock_balances` and `customer_jar_balances` integers; dispensers tracked in an `assets` table with `serial_number`.

---

### Question 4: Delivery Driver Compensation & Incentives
- **Context:** How are the 2–3 delivery drivers compensated?
- **Options:**
  - *Option A (Recommended):* Base Salary + Per-Jar Commission. A fixed monthly wage plus an incentive (e.g., $1.00–$2.00 per full jar delivered and $0.50 per empty jar safely returned).
  - *Option B:* Fixed Monthly Salary only.
  - *Option C:* Pure Piece-Rate / Subcontractor Model (Paid strictly per trip or per jar delivered).
- **Default Recommendation:** Option A.
- **Database & Architecture Impact:** Requires `staff_commissions` rules engine and links trip delivery totals to the monthly payroll calculation.

---

### Question 5: Route Scheduling & Customer Order Generation
- **Context:** How are orders initiated on a day-to-day basis?
- **Options:**
  - *Option A (Recommended):* Hybrid Recurring Subscriptions + On-Demand. Fixed routes run on designated days (e.g., Route 1 on Mon-Wed-Fri, Route 2 on Tue-Thu-Sat) where system auto-generates orders for scheduled customers, while dispatchers can insert ad-hoc call-in orders.
  - *Option B:* Pure On-Demand. Customers must call, message, or order every time they need water.
- **Default Recommendation:** Option A.
- **Database & Architecture Impact:** Requires a `subscriptions` table with cron-based daily order generation.

---

### Question 6: Taxation, Invoicing & Regional Compliance
- **Context:** What tax regime governs the water business?
- **Options:**
  - *Option A (India GST Model):* HSN 2201 for Packaged Drinking Water (18% GST). B2B customers require GSTIN, formal Tax Invoices with CGST/SGST/IGST breakdown, and monthly e-way bills for large vehicle loads. B2C gets simplified retail cash memos.
  - *Option B (US/International Sales Tax):* State/local sales tax or zero-rated essential food/water.
  - *Option C:* Composition / Simplified Flat Tax Scheme.
- **Default Recommendation:** Option A with configurable tax rates in `business_settings`.
- **Database & Architecture Impact:** Adds tax rate breakdowns (`cgst_amount`, `sgst_amount`, `igst_amount`, `hsn_code`) to order items and invoices.

---

### Question 7: Payment Collection & Instant Reconciliation
- **Context:** How do drivers collect and register digital payments?
- **Options:**
  - *Option A (Recommended):* Cash + Dynamic UPI QR Codes. Driver's mobile web app displays a dynamic UPI QR code containing the order ID and amount. Customer scans with Google Pay / PhonePe / Paytm; driver enters the 12-digit UPI reference (UTR) or payment gateway webhook confirms receipt.
  - *Option B:* Cash Only on Route. Corporate clients pay via monthly bank transfer.
  - *Option C:* Pre-paid Customer Wallet / Coupon Booklet. Customers buy digital coupon packs in advance; driver redeems coupons upon drop-off.
- **Default Recommendation:** Option A + Option C (pre-paid customer balance capability).
- **Database & Architecture Impact:** Requires `payment_records` table linked to orders with `transaction_reference` and `payment_mode`.

---

### Question 8: Delivery Staff Mobile Hardware & Offline Resilience
- **Context:** Drivers often deliver in basement car parks, elevator lobbies, or areas with poor cellular connectivity.
- **Options:**
  - *Option A (Recommended):* Responsive PWA / Mobile Web with optimistic UI and local storage caching for active route stops.
  - *Option B:* Online-only Mobile Web (assumes continuous 4G/5G).
- **Default Recommendation:** Option A.
- **Database & Architecture Impact:** Driver API endpoints designed with idempotency keys to safely process queued drop-off logs without duplicate charging.
