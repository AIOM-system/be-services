export enum InventoryChangeType {
  IMPORT = "import", // From import receipt
  RETURN = "return", // From return receipt
  CHECK = "check", // From inventory check
  MANUAL = "manual", // Manual adjustment
  SYSTEM = "system", // System adjustment
  SALE = "sale", // From sale receipt (negative inventory change)
}

export enum TopStockSortBy {
  INVENTORY = "inventory",
  VALUE = "value",
}
