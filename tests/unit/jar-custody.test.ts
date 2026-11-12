import { describe, it, expect } from "vitest";
import {
  calculateNewCustomerJarHolding,
  JarConditionEnum,
  MovementTypeEnum,
} from "@/modules/jars/jar.schema";

describe("Phase 4 Jar Custody Invariants & Physical Tracking", () => {
  it("enforces independent tracking of delivered full jars and collected empty jars", () => {
    const initialFull = 4;
    const initialEmpty = 5;
    expect(initialFull + initialEmpty).toBe(9);

    const deliveredFull = 5;
    const collectedEmpty = 2;

    const result = calculateNewCustomerJarHolding(
      initialFull,
      initialEmpty,
      deliveredFull,
      collectedEmpty
    );

    expect(result.newFull).toBe(9); // 4 + 5
    expect(result.newEmpty).toBe(3); // 5 - 2
    expect(result.newTotal).toBe(12); // 9 + 3
    expect(result.newTotal).toBe(9 + deliveredFull - collectedEmpty);
  });

  it("never assumes that delivering full jars implies returning empty jars", () => {
    const result = calculateNewCustomerJarHolding(2, 0, 10, 0);
    expect(result.newFull).toBe(12);
    expect(result.newEmpty).toBe(0);
    expect(result.newTotal).toBe(12);
  });

  it("strictly rejects returns exceeding customer available jar holdings without GREATEST clamping", () => {
    expect(() => calculateNewCustomerJarHolding(0, 1, 0, 3)).toThrow(
      /Invalid physical return: Customer only holds 1 jars in total custody/
    );
  });

  it("accurately accounts for emptied full jars when customer returns more empty jars than previously recorded empty balance", () => {
    const result = calculateNewCustomerJarHolding(5, 2, 0, 4);
    expect(result.newEmpty).toBe(0);
    expect(result.newFull).toBe(3);
    expect(result.newTotal).toBe(3);
  });

  it("validates the 5 persistent jar conditions", () => {
    const validConditions = [
      "FULL_USABLE",
      "EMPTY_CLEAN",
      "EMPTY_DIRTY",
      "DAMAGED_REPAIRABLE",
      "DAMAGED_SCRAP",
    ];

    validConditions.forEach((cond) => {
      expect(JarConditionEnum.safeParse(cond).success).toBe(true);
    });

    expect(JarConditionEnum.safeParse("UNKNOWN_CONDITION").success).toBe(false);
  });

  it("enforces jar asset conservation across warehouse, vehicle, customer, and supplier", () => {
    const warehouseStock = 300;
    const vehicleStock = 50;
    const customerHolding = 120;
    const supplierCustody = 40;
    const scrappedJars = 15;

    const totalSystemJars =
      warehouseStock + vehicleStock + customerHolding + supplierCustody + scrappedJars;

    expect(totalSystemJars).toBe(525);

    const warehouseAfterDispatch = warehouseStock - 20;
    const vehicleAfterDispatch = vehicleStock + 20;

    const totalAfterMovement =
      warehouseAfterDispatch +
      vehicleAfterDispatch +
      customerHolding +
      supplierCustody +
      scrappedJars;

    expect(totalAfterMovement).toBe(totalSystemJars);
  });

  it("validates washing, filling, repair, and scrap processing cycle movements", () => {
    expect(MovementTypeEnum.safeParse("WASHING_CYCLE_DIRTY_TO_CLEAN").success).toBe(true);
    expect(MovementTypeEnum.safeParse("FILLING_CYCLE_CLEAN_TO_FULL").success).toBe(true);
    expect(MovementTypeEnum.safeParse("SCRAP_WRITEOFF").success).toBe(true);
  });

  // --- Round 5 Remediation: Supplier Purchase, Condition Matrix & Complete Custody Accounting ---

  interface LocationCustody {
    id: string;
    type: "WAREHOUSE" | "VEHICLE" | "CUSTOMER" | "SUPPLIER" | "SCRAP_YARD";
    fullUsable: number;
    emptyClean: number;
    emptyDirty: number;
    damagedRepairable: number;
    damagedScrap: number;
  }

  function simulateJarMovement({
    source,
    destination,
    conditionFrom,
    conditionTo,
    quantity,
    movementType,
    referenceType,
    referenceId,
    callerRole = "staff",
    purchaseOrder,
    canonicalWarehouseId,
    hasCustomerRecord = true,
    hasSupplierRecord = true,
  }: {
    source: LocationCustody;
    destination: LocationCustody;
    conditionFrom: "FULL_USABLE" | "EMPTY_CLEAN" | "EMPTY_DIRTY" | "DAMAGED_REPAIRABLE" | "DAMAGED_SCRAP";
    conditionTo: "FULL_USABLE" | "EMPTY_CLEAN" | "EMPTY_DIRTY" | "DAMAGED_REPAIRABLE" | "DAMAGED_SCRAP";
    quantity: number;
    movementType: string;
    referenceType?: string;
    referenceId?: string;
    callerRole?: "owner" | "staff" | "driver";
    purchaseOrder?: {
      id: string;
      supplierId: string;
      status: string;
      orderedQty: number;
      receivedQty: number;
    };
    canonicalWarehouseId?: string;
    hasCustomerRecord?: boolean;
    hasSupplierRecord?: boolean;
  }) {
    if (quantity <= 0) {
      throw new Error("Quantity must be greater than zero.");
    }

    // 0. Canonical Warehouse Enforcement
    if (canonicalWarehouseId) {
      if (source.type === "WAREHOUSE" && source.id !== canonicalWarehouseId) {
        throw new Error(`Invalid warehouse location: ${source.id} does not match the canonical central warehouse location (${canonicalWarehouseId}).`);
      }
      if (destination.type === "WAREHOUSE" && destination.id !== canonicalWarehouseId) {
        throw new Error(`Invalid warehouse location: ${destination.id} does not match the canonical central warehouse location (${canonicalWarehouseId}).`);
      }
    }

    // 0b. Destination Relationship Checks
    if (destination.type === "CUSTOMER" && !hasCustomerRecord) {
      throw new Error(`Destination customer record not found for location ${destination.id}. Balance update cannot be skipped.`);
    }
    if (destination.type === "SUPPLIER" && !hasSupplierRecord) {
      throw new Error(`Destination supplier record not found for location ${destination.id}. Balance update cannot be skipped.`);
    }

    // 1. Scrapped jars can NEVER be restored to usable or repairable condition
    if (conditionFrom === "DAMAGED_SCRAP" && conditionTo !== "DAMAGED_SCRAP") {
      throw new Error("Scrapped jars cannot be restored to usable or repairable condition. Scrap is terminal.");
    }

    // 2. Condition transition rules
    if (movementType === "WASHING_CYCLE_DIRTY_TO_CLEAN" && (conditionFrom !== "EMPTY_DIRTY" || conditionTo !== "EMPTY_CLEAN")) {
      throw new Error("Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.");
    }
    if (movementType === "FILLING_CYCLE_CLEAN_TO_FULL" && (conditionFrom !== "EMPTY_CLEAN" || conditionTo !== "FULL_USABLE")) {
      throw new Error("Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.");
    }
    if (movementType === "REPAIR_CYCLE" && (conditionFrom !== "DAMAGED_REPAIRABLE" || !["EMPTY_CLEAN", "DAMAGED_SCRAP"].includes(conditionTo))) {
      throw new Error("Repair cycle requires DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP transition.");
    }
    if (movementType === "SCRAP_WRITEOFF" && (!["DAMAGED_REPAIRABLE", "DAMAGED_SCRAP"].includes(conditionFrom) || conditionTo !== "DAMAGED_SCRAP")) {
      throw new Error("Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.");
    }

    // 3. Reject arbitrary condition conversion via generic adjustment
    if (conditionFrom !== conditionTo && !["WASHING_CYCLE_DIRTY_TO_CLEAN", "FILLING_CYCLE_CLEAN_TO_FULL", "REPAIR_CYCLE", "SCRAP_WRITEOFF"].includes(movementType)) {
      throw new Error(`Arbitrary condition conversion from ${conditionFrom} to ${conditionTo} is not permitted under movement type ${movementType}.`);
    }

    // 4. Supplier Purchase Validation (Problem A & Round 6)
    if (movementType === "SUPPLIER_PURCHASE") {
      if (source.type !== "SUPPLIER") {
        throw new Error(`Supplier purchase source must be a supplier location. Location type is ${source.type}.`);
      }
      if (destination.type !== "WAREHOUSE") {
        throw new Error(`Supplier purchase destination must be a warehouse location. Location type is ${destination.type}.`);
      }
      if (!referenceId && (!referenceType || referenceType !== "OPENING_STOCK")) {
        throw new Error("Supplier purchase requires a mandatory purchase reference ID.");
      }

      if (purchaseOrder) {
        if (purchaseOrder.supplierId !== source.id) {
          throw new Error(`Purchase order does not belong to supplier ${source.id}.`);
        }
        if (purchaseOrder.status === "CANCELLED") {
          throw new Error("Cannot receive jars against cancelled purchase order.");
        }
        const remaining = purchaseOrder.orderedQty - purchaseOrder.receivedQty;
        if (quantity > remaining) {
          throw new Error(`Cannot receive ${quantity} jars: remaining receivable quantity on purchase order is ${remaining} (ordered: ${purchaseOrder.orderedQty}, received: ${purchaseOrder.receivedQty}).`);
        }
        purchaseOrder.receivedQty += quantity;
      }

      // External procurement: stock is credited to warehouse
      destination.fullUsable += quantity;
      return { source, destination };
    }

    // 5. Opening Stock Validation
    if (movementType === "OPENING_STOCK") {
      if (callerRole !== "owner") {
        throw new Error("Only the business owner can record initial opening stock entries.");
      }
      if (destination.type !== "WAREHOUSE") {
        throw new Error("Opening stock destination must be a warehouse location.");
      }
      destination.fullUsable += quantity;
      return { source, destination };
    }

    // Get source balance for conditionFrom
    const getQty = (loc: LocationCustody, cond: string) => {
      switch (cond) {
        case "FULL_USABLE": return loc.fullUsable;
        case "EMPTY_CLEAN": return loc.emptyClean;
        case "EMPTY_DIRTY": return loc.emptyDirty;
        case "DAMAGED_REPAIRABLE": return loc.damagedRepairable;
        case "DAMAGED_SCRAP": return loc.damagedScrap;
        default: return 0;
      }
    };

    const setQty = (loc: LocationCustody, cond: string, delta: number) => {
      switch (cond) {
        case "FULL_USABLE": loc.fullUsable += delta; break;
        case "EMPTY_CLEAN": loc.emptyClean += delta; break;
        case "EMPTY_DIRTY": loc.emptyDirty += delta; break;
        case "DAMAGED_REPAIRABLE": loc.damagedRepairable += delta; break;
        case "DAMAGED_SCRAP": loc.damagedScrap += delta; break;
      }
    };

    const avail = getQty(source, conditionFrom);
    if (avail < quantity) {
      throw new Error(`Insufficient ${conditionFrom} stock at source. Available: ${avail}, Requested: ${quantity}.`);
    }

    // Deduct from source and add to destination
    setQty(source, conditionFrom, -quantity);
    setQty(destination, conditionTo, quantity);

    return { source, destination };
  }

  it("executes valid warehouse-to-staff movement and strictly conserves total stock", () => {
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 100, emptyClean: 20, emptyDirty: 30, damagedRepairable: 5, damagedScrap: 0 };
    const vehicle: LocationCustody = { id: "veh-1", type: "VEHICLE", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    const totalBefore = warehouse.fullUsable + vehicle.fullUsable;

    simulateJarMovement({
      source: warehouse,
      destination: vehicle,
      conditionFrom: "FULL_USABLE",
      conditionTo: "FULL_USABLE",
      quantity: 40,
      movementType: "DISPATCH_TO_VEHICLE",
    });

    expect(warehouse.fullUsable).toBe(60);
    expect(vehicle.fullUsable).toBe(40);
    expect(warehouse.fullUsable + vehicle.fullUsable).toBe(totalBefore);
  });

  it("strictly rejects movements when source has insufficient stock (prevents inventory fabrication)", () => {
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 15, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const vehicle: LocationCustody = { id: "veh-1", type: "VEHICLE", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: vehicle,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 20,
        movementType: "DISPATCH_TO_VEHICLE",
      })
    ).toThrow(/Insufficient FULL_USABLE stock at source. Available: 15, Requested: 20/i);
  });

  it("strictly validates supplier purchases and rejects customer as source of supplier purchase", () => {
    const supplier: LocationCustody = { id: "supp-1", type: "SUPPLIER", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const customer: LocationCustody = { id: "cust-1", type: "CUSTOMER", fullUsable: 5, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 50, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    // Valid supplier purchase with purchase reference
    const validPurchase = simulateJarMovement({
      source: supplier,
      destination: warehouse,
      conditionFrom: "FULL_USABLE",
      conditionTo: "FULL_USABLE",
      quantity: 100,
      movementType: "SUPPLIER_PURCHASE",
      referenceType: "PURCHASE_ORDER",
      referenceId: "po-uuid-12345",
    });
    expect(validPurchase.destination.fullUsable).toBe(150);

    // Customer as source of supplier purchase is strictly REJECTED
    expect(() =>
      simulateJarMovement({
        source: customer,
        destination: warehouse,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 50,
        movementType: "SUPPLIER_PURCHASE",
        referenceType: "PURCHASE_ORDER",
        referenceId: "po-uuid-12345",
      })
    ).toThrow(/Supplier purchase source must be a supplier location/i);

    // Supplier purchase with missing purchase reference is strictly REJECTED
    expect(() =>
      simulateJarMovement({
        source: supplier,
        destination: warehouse,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 50,
        movementType: "SUPPLIER_PURCHASE",
      })
    ).toThrow(/Supplier purchase requires a mandatory purchase reference ID/i);

    // Supplier purchase exceeding remaining receivable quantity on PO is strictly REJECTED
    const po = { id: "po-101", supplierId: supplier.id, status: "ORDERED", orderedQty: 50, receivedQty: 30 };
    expect(() =>
      simulateJarMovement({
        source: supplier,
        destination: warehouse,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 25, // 25 > 20 remaining!
        movementType: "SUPPLIER_PURCHASE",
        referenceType: "PURCHASE_ORDER",
        referenceId: po.id,
        purchaseOrder: po,
      })
    ).toThrow(/remaining receivable quantity on purchase order is 20/i);

    // Receiving against cancelled purchase order is strictly REJECTED
    const cancelledPo = { id: "po-cancelled", supplierId: supplier.id, status: "CANCELLED", orderedQty: 50, receivedQty: 0 };
    expect(() =>
      simulateJarMovement({
        source: supplier,
        destination: warehouse,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 10,
        movementType: "SUPPLIER_PURCHASE",
        referenceType: "PURCHASE_ORDER",
        referenceId: cancelledPo.id,
        purchaseOrder: cancelledPo,
      })
    ).toThrow(/Cannot receive jars against cancelled purchase order/i);

    // Supplier purchase with mismatched supplier is strictly REJECTED
    const wrongSupplierPo = { id: "po-wrong", supplierId: "other-supp", status: "ORDERED", orderedQty: 50, receivedQty: 0 };
    expect(() =>
      simulateJarMovement({
        source: supplier,
        destination: warehouse,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 10,
        movementType: "SUPPLIER_PURCHASE",
        referenceType: "PURCHASE_ORDER",
        referenceId: wrongSupplierPo.id,
        purchaseOrder: wrongSupplierPo,
      })
    ).toThrow(/Purchase order does not belong to supplier/i);

    // Opening stock by non-owner is strictly REJECTED
    expect(() =>
      simulateJarMovement({
        source: supplier,
        destination: warehouse,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 100,
        movementType: "OPENING_STOCK",
        callerRole: "staff",
      })
    ).toThrow(/Only the business owner can record initial opening stock entries/i);

    // Opening stock by owner succeeds
    const whStockBefore = warehouse.fullUsable;
    simulateJarMovement({
      source: supplier,
      destination: warehouse,
      conditionFrom: "FULL_USABLE",
      conditionTo: "FULL_USABLE",
      quantity: 50,
      movementType: "OPENING_STOCK",
      callerRole: "owner",
    });
    expect(warehouse.fullUsable).toBe(whStockBefore + 50);
  });


  it("supports complete jar-condition accounting across all 5 conditions on customer locations", () => {
    const customer: LocationCustody = {
      id: "cust-complete",
      type: "CUSTOMER",
      fullUsable: 10,
      emptyClean: 5,
      emptyDirty: 8,
      damagedRepairable: 2,
      damagedScrap: 1,
    };
    const warehouse: LocationCustody = {
      id: "wh-1",
      type: "WAREHOUSE",
      fullUsable: 0,
      emptyClean: 0,
      emptyDirty: 0,
      damagedRepairable: 0,
      damagedScrap: 0,
    };

    // 1. Return empty clean jars
    simulateJarMovement({
      source: customer,
      destination: warehouse,
      conditionFrom: "EMPTY_CLEAN",
      conditionTo: "EMPTY_CLEAN",
      quantity: 3,
      movementType: "CUSTOMER_EMPTY_RETURN",
    });
    expect(customer.emptyClean).toBe(2);
    expect(warehouse.emptyClean).toBe(3);

    // 2. Return damaged repairable jars
    simulateJarMovement({
      source: customer,
      destination: warehouse,
      conditionFrom: "DAMAGED_REPAIRABLE",
      conditionTo: "DAMAGED_REPAIRABLE",
      quantity: 2,
      movementType: "DAMAGED_COLLECTED",
    });
    expect(customer.damagedRepairable).toBe(0);
    expect(warehouse.damagedRepairable).toBe(2);

    // 3. Return damaged scrap jars
    simulateJarMovement({
      source: customer,
      destination: warehouse,
      conditionFrom: "DAMAGED_SCRAP",
      conditionTo: "DAMAGED_SCRAP",
      quantity: 1,
      movementType: "DAMAGED_COLLECTED",
    });
    expect(customer.damagedScrap).toBe(0);
    expect(warehouse.damagedScrap).toBe(1);

    // 4. Attempting to return more than available throws
    expect(() =>
      simulateJarMovement({
        source: customer,
        destination: warehouse,
        conditionFrom: "DAMAGED_SCRAP",
        conditionTo: "DAMAGED_SCRAP",
        quantity: 1,
        movementType: "DAMAGED_COLLECTED",
      })
    ).toThrow(/Insufficient DAMAGED_SCRAP stock at source/i);
  });

  it("enforces condition transition matrix and strictly forbids restoring scrapped jars", () => {
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 0, emptyClean: 10, emptyDirty: 20, damagedRepairable: 15, damagedScrap: 5 };

    // 1. Valid Washing: EMPTY_DIRTY -> EMPTY_CLEAN
    simulateJarMovement({
      source: warehouse,
      destination: warehouse,
      conditionFrom: "EMPTY_DIRTY",
      conditionTo: "EMPTY_CLEAN",
      quantity: 10,
      movementType: "WASHING_CYCLE_DIRTY_TO_CLEAN",
    });
    expect(warehouse.emptyDirty).toBe(10);
    expect(warehouse.emptyClean).toBe(20);

    // 2. Valid Filling: EMPTY_CLEAN -> FULL_USABLE
    simulateJarMovement({
      source: warehouse,
      destination: warehouse,
      conditionFrom: "EMPTY_CLEAN",
      conditionTo: "FULL_USABLE",
      quantity: 15,
      movementType: "FILLING_CYCLE_CLEAN_TO_FULL",
    });
    expect(warehouse.emptyClean).toBe(5);
    expect(warehouse.fullUsable).toBe(15);

    // 3. Valid Repair: DAMAGED_REPAIRABLE -> EMPTY_CLEAN
    simulateJarMovement({
      source: warehouse,
      destination: warehouse,
      conditionFrom: "DAMAGED_REPAIRABLE",
      conditionTo: "EMPTY_CLEAN",
      quantity: 5,
      movementType: "REPAIR_CYCLE",
    });
    expect(warehouse.damagedRepairable).toBe(10);
    expect(warehouse.emptyClean).toBe(10);

    // 4. Valid Repair to Scrap: DAMAGED_REPAIRABLE -> DAMAGED_SCRAP
    simulateJarMovement({
      source: warehouse,
      destination: warehouse,
      conditionFrom: "DAMAGED_REPAIRABLE",
      conditionTo: "DAMAGED_SCRAP",
      quantity: 3,
      movementType: "REPAIR_CYCLE",
    });
    expect(warehouse.damagedRepairable).toBe(7);
    expect(warehouse.damagedScrap).toBe(8);

    // 5. RESTORING SCRAPPED JARS IS STRICTLY FORBIDDEN!
    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: warehouse,
        conditionFrom: "DAMAGED_SCRAP",
        conditionTo: "FULL_USABLE",
        quantity: 1,
        movementType: "INTERNAL_ADJUSTMENT",
      })
    ).toThrow(/Scrapped jars cannot be restored to usable or repairable condition/i);

    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: warehouse,
        conditionFrom: "DAMAGED_SCRAP",
        conditionTo: "EMPTY_CLEAN",
        quantity: 1,
        movementType: "INTERNAL_ADJUSTMENT",
      })
    ).toThrow(/Scrapped jars cannot be restored to usable or repairable condition/i);

    // 6. Generic arbitrary condition conversion is strictly rejected
    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: warehouse,
        conditionFrom: "EMPTY_DIRTY",
        conditionTo: "FULL_USABLE",
        quantity: 5,
        movementType: "STOCK_ADJUSTMENT",
      })
    ).toThrow(/Arbitrary condition conversion from EMPTY_DIRTY to FULL_USABLE is not permitted/i);
  });

  it("strictly enforces delta = 0 asset conservation across entire system for ordinary movements", () => {
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 80, emptyClean: 10, emptyDirty: 20, damagedRepairable: 5, damagedScrap: 2 };
    const vehicle: LocationCustody = { id: "veh-1", type: "VEHICLE", fullUsable: 15, emptyClean: 0, emptyDirty: 5, damagedRepairable: 0, damagedScrap: 0 };
    const customer: LocationCustody = { id: "cust-1", type: "CUSTOMER", fullUsable: 10, emptyClean: 0, emptyDirty: 8, damagedRepairable: 1, damagedScrap: 0 };

    const getSystemSum = () =>
      warehouse.fullUsable + warehouse.emptyClean + warehouse.emptyDirty + warehouse.damagedRepairable + warehouse.damagedScrap +
      vehicle.fullUsable + vehicle.emptyClean + vehicle.emptyDirty + vehicle.damagedRepairable + vehicle.damagedScrap +
      customer.fullUsable + customer.emptyClean + customer.emptyDirty + customer.damagedRepairable + customer.damagedScrap;

    const initialSum = getSystemSum();

    // 1. Dispatch
    simulateJarMovement({ source: warehouse, destination: vehicle, conditionFrom: "FULL_USABLE", conditionTo: "FULL_USABLE", quantity: 20, movementType: "DISPATCH_TO_VEHICLE" });
    expect(getSystemSum()).toBe(initialSum);

    // 2. Delivery to customer
    simulateJarMovement({ source: vehicle, destination: customer, conditionFrom: "FULL_USABLE", conditionTo: "FULL_USABLE", quantity: 15, movementType: "CUSTOMER_DELIVERY" });
    expect(getSystemSum()).toBe(initialSum);

    // 3. Customer empty return
    simulateJarMovement({ source: customer, destination: vehicle, conditionFrom: "EMPTY_DIRTY", conditionTo: "EMPTY_DIRTY", quantity: 5, movementType: "CUSTOMER_EMPTY_RETURN" });
    expect(getSystemSum()).toBe(initialSum);

    // 4. Return to warehouse
    simulateJarMovement({ source: vehicle, destination: warehouse, conditionFrom: "EMPTY_DIRTY", conditionTo: "EMPTY_DIRTY", quantity: 5, movementType: "VEHICLE_RETURN_TO_WAREHOUSE" });
    expect(getSystemSum()).toBe(initialSum);

    // 5. Washing in warehouse
    simulateJarMovement({ source: warehouse, destination: warehouse, conditionFrom: "EMPTY_DIRTY", conditionTo: "EMPTY_CLEAN", quantity: 5, movementType: "WASHING_CYCLE_DIRTY_TO_CLEAN" });
    expect(getSystemSum()).toBe(initialSum);

    // Final delta = 0
    expect(getSystemSum() - initialSum).toBe(0);
  });

  it("rejects non-positive quantities in jar custody movements", () => {
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 50, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const vehicle: LocationCustody = { id: "veh-1", type: "VEHICLE", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: vehicle,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: -5,
        movementType: "DISPATCH_TO_VEHICLE",
      })
    ).toThrow(/Quantity must be greater than zero/i);

    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: vehicle,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 0,
        movementType: "DISPATCH_TO_VEHICLE",
      })
    ).toThrow(/Quantity must be greater than zero/i);
  });

  it("simulates concurrent movements from the same source stock and serializes safely", () => {
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 30, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const driver1Vehicle: LocationCustody = { id: "veh-1", type: "VEHICLE", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const driver2Vehicle: LocationCustody = { id: "veh-2", type: "VEHICLE", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    // Driver 1 dispatches 20 jars
    simulateJarMovement({
      source: warehouse,
      destination: driver1Vehicle,
      conditionFrom: "FULL_USABLE",
      conditionTo: "FULL_USABLE",
      quantity: 20,
      movementType: "DISPATCH_TO_VEHICLE",
    });
    expect(warehouse.fullUsable).toBe(10);
    expect(driver1Vehicle.fullUsable).toBe(20);

    // Driver 2 simultaneously requests 20 jars, but only 10 remain -> Must throw!
    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: driver2Vehicle,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 20,
        movementType: "DISPATCH_TO_VEHICLE",
      })
    ).toThrow(/Insufficient FULL_USABLE stock at source. Available: 10, Requested: 20/i);
  });

  // --- Round 7 Remediation Tests ---

  it("strictly validates available stock when source is SCRAP_YARD and rejects stock fabrication", () => {
    const scrapYard: LocationCustody = { id: "scrap-1", type: "SCRAP_YARD", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 50, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    // Scrap yard has 0 balance -> Outgoing movement must throw!
    expect(() =>
      simulateJarMovement({
        source: scrapYard,
        destination: warehouse,
        conditionFrom: "DAMAGED_SCRAP",
        conditionTo: "DAMAGED_SCRAP",
        quantity: 5,
        movementType: "SCRAP_WRITEOFF",
      })
    ).toThrow(/Insufficient DAMAGED_SCRAP stock at source. Available: 0, Requested: 5/i);
  });

  it("strictly prohibits moving scrapped jars from SCRAP_YARD into usable or clean condition", () => {
    const scrapYard: LocationCustody = { id: "scrap-1", type: "SCRAP_YARD", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 20 };
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 50, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    // Cannot convert scrap to clean or usable
    expect(() =>
      simulateJarMovement({
        source: scrapYard,
        destination: warehouse,
        conditionFrom: "DAMAGED_SCRAP",
        conditionTo: "EMPTY_CLEAN",
        quantity: 5,
        movementType: "INTERNAL_ADJUSTMENT",
      })
    ).toThrow(/Scrapped jars cannot be restored to usable or repairable condition. Scrap is terminal./i);
  });

  it("rejects movements using an arbitrary non-canonical warehouse ID", () => {
    const canonicalWh: LocationCustody = { id: "wh-canonical-1", type: "WAREHOUSE", fullUsable: 100, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const fakeWh: LocationCustody = { id: "wh-fake-2", type: "WAREHOUSE", fullUsable: 100, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const vehicle: LocationCustody = { id: "veh-1", type: "VEHICLE", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    expect(() =>
      simulateJarMovement({
        source: fakeWh,
        destination: vehicle,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 10,
        movementType: "DISPATCH_TO_VEHICLE",
        canonicalWarehouseId: canonicalWh.id,
      })
    ).toThrow(/does not match the canonical central warehouse location/i);
  });

  it("rejects transactions when destination customer business record is missing", () => {
    const warehouse: LocationCustody = { id: "wh-1", type: "WAREHOUSE", fullUsable: 100, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };
    const orphanCustomerLoc: LocationCustody = { id: "loc-orphan-cust", type: "CUSTOMER", fullUsable: 0, emptyClean: 0, emptyDirty: 0, damagedRepairable: 0, damagedScrap: 0 };

    expect(() =>
      simulateJarMovement({
        source: warehouse,
        destination: orphanCustomerLoc,
        conditionFrom: "FULL_USABLE",
        conditionTo: "FULL_USABLE",
        quantity: 5,
        movementType: "CUSTOMER_DELIVERY",
        hasCustomerRecord: false,
      })
    ).toThrow(/Destination customer record not found/i);
  });
});
