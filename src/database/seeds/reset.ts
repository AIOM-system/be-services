// path to a file with schema you want to reset
import { drizzle } from "drizzle-orm/postgres-js";
import { reset } from "drizzle-seed";

import { supplierTable } from "../schemas/supplier.schema.ts";
import { productTable } from "../schemas/product.schema.ts";
import { productSupplierTable } from "../schemas/product-supplier.schema.ts";
import { productInventoryLogTable } from "../schemas/product-inventory-log.schema.ts";
import { receiptImportTable } from "../schemas/receipt-import.schema.ts";
import { receiptReturnTable } from "../schemas/receipt-return.schema.ts";
import { receiptCheckTable } from "../schemas/receipt-check.schema.ts";
import { receiptItemTable } from "../schemas/receipt-item.schema.ts";
import { orderTable } from "../schemas/order.schema.ts";
import { userActivityTable } from "../schemas/user-activity.schema.ts";
import { notificationTable } from "../schemas/notification.schema.ts";

async function main() {
  try {
    const DATABASE_URL = "postgresql://localhost:5432/aiom_db"
    const db = drizzle(DATABASE_URL);
    console.log({ database_url: DATABASE_URL });

    console.time("Reset database");
    await reset(db, {
      orderTable,
      productTable,
      productSupplierTable,
      productInventoryLogTable,
      supplierTable,
      receiptImportTable,
      receiptReturnTable,
      receiptCheckTable,
      receiptItemTable,
      userActivityTable,
      notificationTable,
    });
    console.timeEnd("Reset database");
    console.log("Database reset successfully");

    Deno.exit(0);
  } catch (error) {
    console.error("Error resetting database", error);
  }
}

main();
