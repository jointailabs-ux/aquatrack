# USER ROLES & ACCESS CONTROL — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

AquaTrack ERP operates on a simplified, high-security access control model with **two primary user categories**:
1. **Owner** (Full Executive & Operational Authority)
2. **Staff** (Individual Authenticated Staff with Configurable Permissions)

There is **no customer authentication, customer login, or customer role**. Customers are purely master-data business entities.

---

## 1. Role Definitions

### 1.1 Owner (`owner`)
The business owner has complete, unrestricted access across the entire application:
- **Executive Oversight:** Dashboard metrics, cash-flow overview, accounts receivable, and profitability.
- **Staff Administration:** Creating staff accounts, resetting credentials, assigning modular permissions, tracking payouts.
- **Master Data:** Customer management, custom pricing rules, supplier directory, product catalog with tax/HSN.
- **Warehouse & Inventory:** Stock balances, condition-wise jar tracking, inventory adjustments, purchase receipts.
- **Delivery & Sales:** Order creation, route scheduling, trip dispatch, trip settlement approval, and POS sales.
- **Financial Control:** Payments recording, operating expenses, staff salary payouts, profit & loss, tax reports, business settings.

### 1.2 Staff (`staff`)
Each staff member receives individual authentication credentials. The system supports flexible operational permissions configured directly by the Owner.

#### Baseline Staff Capabilities (Delivery Operations):
- View deliveries and customer stops assigned to them.
- View customer details required for delivery (name, phone, address, drop instructions).
- Mark deliveries completed, partially delivered, or failed with reasons.
- Record actual full jars / beverages delivered.
- Record empty clean/dirty jars collected.
- Record damaged jars collected.
- Record cash or UPI payments collected at customer premises.
- View personal delivery history and daily route settlement summary.

#### Modular Staff Permissions (Granted by Owner):
In addition to delivery operations, the Owner can grant specific staff members additional privileges:
- `can_pos`: Access Point of Sale (POS) for walk-in counter sales, cart checkout, and cash/UPI receipt generation.
- `can_warehouse`: Access central warehouse inventory intake, jar condition sorting, and stock counting.
- `can_manage_customers`: Create new customer profiles or update customer contact/address details.
- `can_manage_orders`: Create and edit customer orders manually.

---

## 2. Permissions Matrix

| Functional Module | Owner | Staff (Delivery Default) | Staff (+POS Permission) | Staff (+Warehouse Permission) |
| :--- | :---: | :---: | :---: | :---: |
| **Executive Dashboard** | Full Access | — | — | — |
| **Staff Delivery App** | Full Access | Active Assigned Stops | Active Assigned Stops | Active Assigned Stops |
| **Customer Directory** | CRUD | Read (Assigned Stops) | Read (Assigned Stops) | Read (Assigned Stops) |
| **Customer Detail Screen** | Full History | Route View Only | Route View Only | Route View Only |
| **Jar Tracking & Circulation**| Full Access | Record Stop Collection | Record Stop Collection | Jar Condition Sorting |
| **Warehouse Inventory** | Full CRUD | Van Custody Only | Van Custody Only | Stock Intake & Counting |
| **Purchases & Suppliers** | Full Access | — | — | Intake / GRN Receiving |
| **Orders Management** | Full CRUD | Assigned Deliveries | Assigned Deliveries | View Dispatch Sheet |
| **Point of Sale (POS)** | Full Access | — | Full POS Sales | — |
| **Payments Recording** | Full Access | Log Stop Payment | Log Stop & POS Payment | — |
| **Expenses Recording** | Full Access | Log Fuel / Route Expense | Log Route Expense | Log Route Expense |
| **Staff Salary Management**| Full Access | View Personal History | View Personal History | View Personal History |
| **Financial & P&L Reports**| Full Access | — | — | — |
| **Settings & Tax Config** | Full Access | — | — | — |
| **Staff User Management** | Full Access | — | — | — |

---

## 3. Database RLS Enforcement

The database enforces access rules via PostgreSQL Row-Level Security (RLS):
1. **Owner (`role = 'owner'`):** Bypasses read/write restrictions across all business tables.
2. **Staff (`role = 'staff'`):**
   - Can select customer records associated with assigned orders.
   - Can update only deliveries and trip stops explicitly assigned to their `profile_id`.
   - Cannot view company financial statements, staff salaries, purchase costs, or profit margins.
   - Cannot modify inventory balances directly; all stock mutations occur through validated database RPCs.
