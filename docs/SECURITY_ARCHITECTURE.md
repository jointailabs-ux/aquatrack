# SECURITY ARCHITECTURE & ACCESS CONTROL — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## 1. Authentication Lifecycle & System Boundary

AquaTrack ERP enforces strict separation between client-accessible public parameters and server-only privileged secrets within a single-location business model.

```
+-----------------------------------------------------------------------------------+
|                         CREDENTIAL ISOLATION BOUNDARY                             |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [ BROWSER RUNTIME (Owner Admin Web App & Staff Mobile Interface) ]               |
|  - Strictly limited to NEXT_PUBLIC_SUPABASE_URL and                               |
|    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.                                          |
|  - Can only query Supabase via JWT-restricted Row-Level Security (RLS).           |
|  - Zero customer login or customer-facing authentication surface.                 |
|                                                                                   |
|  ============================== AIR GAP ========================================  |
|                                                                                   |
|  [ SERVER RUNTIME (Next.js Server Actions & Database Engine) ]                    |
|  - Protected by `import 'server-only';`                                           |
|  - Holds SUPABASE_SECRET_KEY and DATABASE_URL.                                    |
|  - Never leaks privileged keys into client bundles or HTML responses.             |
|  - Executes high-privilege atomic RPC transactions for inventory and financials.  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Two-Tier Access Model & Role-Based Authorization

AquaTrack ERP secures all operations across two main user categories:

### 2.1 Owner (`owner`)
- Unrestricted access across all database tables, dashboards, and reports.
- Ability to provision staff accounts, assign modular permission flags, and update system settings.
- Only role permitted to view profit and loss, operating margins, cost prices, and staff compensation.

### 2.2 Staff (`staff`)
- Individual login accounts managed and configured by the Owner.
- By default, restricted to mobile delivery execution:
  - Can only select and view orders/stops assigned to their `profile_id`.
  - Can update only delivery status, delivered quantities, collected jars, and collected payments for their assigned trips.
  - Strictly blocked from company financial ledgers, purchase costs, other staff members' salary details, and executive analytics.
- **Configurable Operational Permissions:**
  - `can_pos`: Authorizes Point of Sale counter operations.
  - `can_warehouse`: Authorizes warehouse stock counting, condition sorting, and intake.
  - `can_manage_customers`: Authorizes creating and updating customer profiles.
  - `can_manage_orders`: Authorizes creating orders on behalf of customers.

### 2.3 Customers (No Authentication Surface)
- Customers are internal business master records.
- **There is no customer role, no customer portal, no customer login, and no customer self-service API.**
- Eliminates circular RLS dependencies, token brute-forcing, and external credential management vulnerabilities.

---

## 3. Database Row-Level Security (RLS) Architecture

Row-Level Security (RLS) is forced across all tables in PostgreSQL.

### 3.1 Security Helper Functions (Hardened Search Path)
```sql
-- Retrieve authenticated caller's role ('owner' or 'staff')
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS VARCHAR AS $$
    SELECT role FROM public.profiles 
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

-- Retrieve staff permission flags
CREATE OR REPLACE FUNCTION public.get_staff_permissions()
RETURNS JSONB AS $$
    SELECT jsonb_build_object(
        'can_pos', can_pos,
        'can_warehouse', can_warehouse,
        'can_manage_customers', can_manage_customers,
        'can_manage_orders', can_manage_orders
    )
    FROM public.profiles 
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';
```

### 3.2 Key RLS Policy Rules
1. **`profiles`:**
   - Owner can read and write all profiles.
   - Staff can read their own profile (`id = auth.uid()`).
   - Staff can update their own `avatar_url` or basic contact information, but are blocked by trigger from modifying `role`, `is_active`, or permissions.
2. **`customers`:**
   - Owner has full CRUD.
   - Staff with `can_manage_customers = true` can create and edit customers.
   - Delivery staff can read customer contact and address details only for assigned deliveries.
3. **`products`:**
   - Owner has full CRUD.
   - Staff can read active products for POS sales and delivery confirmation. Wholesale `cost_price` is restricted to the Owner.
4. **`orders` & `delivery_trips`:**
   - Owner has full CRUD.
   - Staff can view trips and stops assigned to them (`assigned_staff_id = auth.uid()`).
5. **`inventory` & `stock_movements`:**
   - Owner has full visibility.
   - Direct `UPDATE` and `DELETE` on stock balances are revoked for all client roles. Mutations execute exclusively via secure database RPCs (`rpc_dispatch_trip`, `rpc_complete_delivery`, `rpc_receive_purchase`, `rpc_pos_sale`).
6. **`expenses` & `salaries`:**
   - Restricted strictly to the Owner.
   - Staff can view only their own personal salary payout history.

---

## 4. Administrative Service-Role Security

When administrative scripts or background processes execute via the Supabase Service-Role key:
```sql
v_is_service_role := (
    auth.role() = 'service_role' OR 
    current_user IN ('postgres', 'supabase_admin')
);
```
- Authenticated via the server-verified JWT role claim or superuser session.
- Cannot be spoofed via client metadata or request headers.
- Authorized for automated setup, system migrations, and administrative provisioning.

---

## 5. Zero-Leakage Credential Mandate

- `SUPABASE_SECRET_KEY` and `DATABASE_URL` reside permanently in server environment variables.
- Neither secret is ever exposed to browser clients, serialized in HTML, or logged to console/files.
- `.env.local` is permanently listed in `.gitignore`.
