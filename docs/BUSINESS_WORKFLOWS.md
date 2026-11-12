# BUSINESS WORKFLOWS — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## Workflow 1: Single-Warehouse Procurement & Supplier Purchases

This workflow governs inventory replenishment from bottling plants and packaging suppliers into the single central warehouse.

```mermaid
sequenceDiagram
    autonumber
    actor O as Owner / Authorized Staff
    actor S as Supplier (Bottling Plant)
    actor W as Central Warehouse Stock

    O->>O: Review Full Stock & Empty Jar Balances
    O->>S: Place Purchase Order (Water Jars / Beverages / Caps)
    alt Reusable Jars Sent for Refill
        O->>S: Dispatch Empty Clean Jars to Plant (Recorded in Supplier Custody)
    end
    S-->>O: Deliver Goods with Delivery Challan / Supplier Bill
    O->>O: Physical Count & Inspection of Received Goods
    O->>W: Post Goods Receipt Note (GRN) in AquaTrack
    Note over W: Inventory Increments (Full Jars / Beverage Stock)
    O->>O: Record Supplier Purchase Invoice
    O->>S: Record Bank / Cash Payment (Full or Partial)
    Note over O: Supplier Payable Balance Updated
```

---

## Workflow 2: Daily Delivery Route & Mobile Staff Execution

The primary daily distribution heartbeat connecting the single central warehouse, delivery vehicles, and customers.

```mermaid
flowchart TD
    Start(["07:00 AM - Shift Begins"]) --> ReviewOrders["Owner/Staff Reviews & Assigns Orders to Staff"]
    ReviewOrders --> LoadVehicle["Load Full Jars & Beverages from Central Warehouse"]
    LoadVehicle --> CashFloat["Issue Cash Float to Driver for Change"]
    CashFloat --> Dispatched["Trip Dispatched (Stock Moves to Vehicle Custody)"]
    
    Dispatched --> MobileDelivery{"Staff Arrives at Customer Stop"}
    MobileDelivery --> OpenMobile["Open Mobile Web Interface on Smartphone"]
    OpenMobile --> DropGoods["Deliver Actual Full Jars / Beverages"]
    DropGoods --> CollectEmpties["Collect Empty Clean / Dirty Jars"]
    CollectEmpties --> CollectDamaged["Collect Damaged / Leaking Jars"]
    CollectDamaged --> PaySelect{"Customer Payment?"}
    PaySelect -- Cash --> LogCash["Record Cash Received"]
    PaySelect -- UPI --> LogUPI["Record UPI Payment Reference"]
    PaySelect -- Credit B2B --> LogCredit["Confirm Credit Delivery on Account"]
    
    LogCash --> NextStop{"More Deliveries?"}
    LogUPI --> NextStop
    LogCredit --> NextStop
    NextStop -- Yes --> MobileDelivery
    NextStop -- No --> ReturnDepot["Return Vehicle to Central Warehouse"]
    
    ReturnDepot --> EveningAudit["Owner Inspects Remaining Full, Returned Empties & Damaged"]
    EveningAudit --> CashRecon["Reconcile Cash Bag: Opening Float + Route Cash - Route Expenses"]
    CashRecon --> TripSettled["Approve Trip Settlement & Post Inventory/Financial Records"]
    TripSettled --> EndShift(["Shift Completed & Ledgers Finalized"])
```

---

## Workflow 3: Customer Management & Jar Tracking (No Customer Login)

Customers do not register or log in. All customer records, deliveries, and jar collections are managed internally by the Owner and staff.

```mermaid
flowchart TD
    Inquiry["New Customer Orders via Phone / WhatsApp"] --> CreateCust["Owner/Staff Creates Customer Record in ERP"]
    CreateCust --> RecordInfo["Enter Name, Phone, Address, Type (B2C/B2B), Pricing, Notes"]
    RecordInfo --> DepositCheck{"Security Deposit Required?"}
    DepositCheck -- Yes --> LogDeposit["Record Refundable Jar Deposit (Liability)"]
    DepositCheck -- No (B2B Credit) --> CreditTerms["Set Agreed Payment Terms & Max Jar Limit"]
    
    LogDeposit --> FirstDelivery["Dispatch Initial Order with Full Jars"]
    CreditTerms --> FirstDelivery
    FirstDelivery --> UpdateHoldings["Customer Jar Holding Increments (+Full Jars)"]
    
    UpdateHoldings --> ReplenishCycle["Ongoing Route Replenishments"]
    ReplenishCycle --> OrderEvent["Staff Delivers Full & Collects Empties"]
    OrderEvent --> UpdateCustody["Customer Holding = Old Holding + Full Delivered - Empties Collected"]
    
    UpdateCustody --> Terminate{"Customer Ends Service?"}
    Terminate -- No --> ReplenishCycle
    Terminate -- Yes --> RetrieveJars["Staff Collects All Empty Jars from Site"]
    RetrieveJars --> InspectJars{"Jars in Good Condition?"}
    InspectJars -- Yes --> FullRefund["Refund Deposit Minus Any Unpaid Invoices"]
    InspectJars -- Damaged/Missing --> NetDeduct["Deduct Replacement Cost from Deposit"]
    NetDeduct --> FullRefund
    FullRefund --> CloseCust["Archive Customer Account & Zero Out Holdings"]
```

---

## Workflow 4: Point of Sale (POS) Walk-In Sales

Quick counter sales at the central warehouse for packaged beverages, bottled water, and walk-in 20L refills.

```mermaid
sequenceDiagram
    autonumber
    actor C as Walk-In Customer
    actor S as Owner / Cashier Staff
    actor POS as AquaTrack POS Module
    actor I as Inventory & Finance

    C->>S: Request Beverage Bottles & 20L Jar Refill
    S->>POS: Search Product & Add to Cart
    alt Walk-In Jar Refill
        C->>S: Hands over Empty Jar
        S->>POS: Verify Empty Jar Condition (Clean/Usable)
    end
    POS->>S: Display Total, Tax (HSN), and Net Due
    S->>C: Request Payment (Cash / UPI QR)
    C->>S: Tender Payment
    S->>POS: Select Tender Mode & Complete Sale
    POS->>I: Instantly Decrement Packaged Beverage Stock in Warehouse
    POS->>I: Record Sales Revenue & Cash/UPI Inflow
    POS-->>S: Print or Share Digital Receipt
    S->>C: Hand over Purchased Beverages & Full Water Jar
```

---

## Workflow 5: Staff Salary & Operating Expense Settlement

Simple financial tracking of staff compensation and facility operating expenses.

```mermaid
flowchart TD
    StartExp(["Operating Cost Event"]) --> ExpType{"Expense Type?"}
    
    ExpType -- Operating Expense --> LogExp["Record Expense: Fuel, Rent, Repairs, Electricity, Packaging"]
    LogExp --> ExpPay["Select Payment Method (Cash, Bank, UPI) & Description"]
    ExpPay --> PostExp["Post to Operating Expenses (Reduces Net Profit)"]
    
    ExpType -- Staff Advance --> LogAdv["Log Advance Payment to Specific Staff Member"]
    LogAdv --> PostAdv["Record Cash Outflow (Stored as Staff Salary Advance)"]
    
    ExpType -- End-of-Month Salary --> CalcSal["Calculate Net Salary = Base Salary - Advances - Deductions"]
    CalcSal --> PaySal["Pay Remaining Amount & Record Payment Date"]
    PaySal --> PostSal["Post Net Salary to Salary Expenses (No Double Counting)"]
    
    PostExp --> FinReport["Financial Reports Updated (P&L, Cash Flow)"]
    PostSal --> FinReport
```
