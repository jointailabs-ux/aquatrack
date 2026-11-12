# DATABASE RELATIONSHIPS & ER DIAGRAMS — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## 1. Master System Entity Relationships

AquaTrack ERP connects physical stock locations, reusable container assets, route operations, procurement, counter sales, and financial records within a simplified single-location architecture.

```mermaid
erDiagram
    PROFILES ||--o{ ORDERS : "creates_or_assigned"
    PROFILES ||--o{ DELIVERY_TRIPS : "executes"
    PROFILES ||--o{ POS_SALES : "tenders"
    PROFILES ||--o{ PAYMENTS : "receives"
    PROFILES ||--o{ PURCHASES : "creates"
    PROFILES ||--o{ EXPENSES : "logs"
    PROFILES ||--o{ STAFF_SALARIES : "compensated_by"
    PROFILES ||--o{ STAFF_ADVANCES : "draws"

    LOCATIONS ||--o| WAREHOUSES : "houses"
    LOCATIONS ||--o| CUSTOMERS : "custody_at"
    LOCATIONS ||--o| SUPPLIERS : "plant_custody"

    LOCATIONS ||--o{ INVENTORY_BALANCES : "stores"
    PRODUCTS ||--o{ INVENTORY_BALANCES : "stocked_as"

    LOCATIONS ||--o{ STOCK_MOVEMENTS : "source_location"
    LOCATIONS ||--o{ STOCK_MOVEMENTS : "destination_location"
    PRODUCTS ||--o{ STOCK_MOVEMENTS : "moves"

    CUSTOMERS ||--o{ ORDERS : "places"
    ORDERS ||--o{ ORDER_ITEMS : "contains"
    PRODUCTS ||--o{ ORDER_ITEMS : "item_product"

    DELIVERY_TRIPS ||--o{ TRIP_STOPS : "sequences"
    ORDERS ||--o| TRIP_STOPS : "delivers"
    CUSTOMERS ||--o{ TRIP_STOPS : "destination"

    POS_SALES ||--o{ POS_SALE_ITEMS : "contains"
    PRODUCTS ||--o{ POS_SALE_ITEMS : "sold_as"

    CUSTOMERS ||--o{ PAYMENTS : "remits"
    ORDERS ||--o{ PAYMENTS : "satisfies"

    SUPPLIERS ||--o{ PURCHASES : "bills"
    PURCHASES ||--o{ PURCHASE_ITEMS : "contains"
    PRODUCTS ||--o{ PURCHASE_ITEMS : "procured_product"
    SUPPLIERS ||--o{ SUPPLIER_PAYMENTS : "paid_by"

    CUSTOMERS ||--o{ CUSTOMER_SPECIAL_PRICES : "negotiates"
    PRODUCTS ||--o{ CUSTOMER_SPECIAL_PRICES : "priced_for"
```

---

## 2. Custody & Reusable Jar Relationships

```mermaid
erDiagram
    LOCATIONS ||--o| WAREHOUSES : "central_depot"
    LOCATIONS ||--o| CUSTOMERS : "customer_site"
    LOCATIONS ||--o| SUPPLIERS : "refilling_plant"

    PRODUCTS ||--o{ INVENTORY_BALANCES : "balances"
    LOCATIONS ||--o{ INVENTORY_BALANCES : "held_at"

    STOCK_MOVEMENTS }o--|| PRODUCTS : "product"
    STOCK_MOVEMENTS }o--|| LOCATIONS : "source"
    STOCK_MOVEMENTS }o--|| LOCATIONS : "destination"

    CUSTOMERS {
        uuid id PK
        uuid location_id FK
        varchar contact_name
        varchar phone
        integer total_full_jars_holding
        integer total_empty_jars_holding
        numeric total_deposit_held
    }

    INVENTORY_BALANCES {
        uuid id PK
        uuid location_id FK
        uuid product_id FK
        varchar condition
        integer quantity
    }

    STOCK_MOVEMENTS {
        uuid id PK
        uuid source_location_id FK
        uuid destination_location_id FK
        uuid product_id FK
        varchar condition
        integer quantity
        varchar movement_type
    }
```

---

## 3. Delivery Route & Trip Stop Linkage

```mermaid
erDiagram
    PROFILES ||--o{ DELIVERY_TRIPS : "assigned_driver"
    DELIVERY_TRIPS ||--o{ TRIP_STOPS : "contains"
    ORDERS ||--o| TRIP_STOPS : "delivers_order"
    CUSTOMERS ||--o{ TRIP_STOPS : "stops_at"

    DELIVERY_TRIPS {
        uuid id PK
        uuid staff_id FK
        date trip_date
        varchar status
        numeric cash_float_given
        numeric cash_collected
        numeric expenses_incurred
    }

    TRIP_STOPS {
        uuid id PK
        uuid trip_id FK
        uuid order_id FK
        uuid customer_id FK
        integer stop_sequence
        varchar status
        integer actual_delivered_qty
        integer empty_jars_collected
        integer damaged_jars_collected
        numeric amount_collected
        varchar payment_method
    }
```
