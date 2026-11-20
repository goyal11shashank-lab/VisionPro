// Preserve the old engine policy until an owner explicitly edits an Inventory
// reservation control. That edit opts into the corrected keys for future orders.
// Existing reservations are never recalculated by reading or saving this policy.
export function resolveOrderReservationSettings(raw: Record<string, any> = {}) {
  const correctedControls = raw.inventory?.reservationControlsVersion === 1;
  return {
    reserveStock: correctedControls ? (raw.inventory?.reserveStockOnSalesOrder ?? true) : true,
    allowBeyondAvailable: correctedControls
      ? (raw.inventory?.allowOrderBeyondAvailable ?? true)
      : (raw.salesOrder?.allowOrderBeyondAvailable ?? true),
    salesOrdersEnabled: raw.orders?.enableSalesOrders ?? true,
  };
}
