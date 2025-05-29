import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { DbTables } from "../../common/config/index.ts";
import { customNumeric } from "../custom/data-types.ts";
import { InventoryChangeType } from "../enums/inventory.enum.ts";

import { productTable } from "./product.schema.ts";
import { userTable } from "./user.schema.ts";

export const inventoryChangeType = pgEnum(
  "inventory_change_type",
  Object.values(InventoryChangeType) as [string, ...string[]],
);

export const productInventoryLogTable = pgTable(DbTables.ProductInventoryLogs, {
  id: uuid("id").primaryKey().defaultRandom(),

  productId: uuid("product_id")
    .notNull()
    .references(() => productTable.id),

  changeType: inventoryChangeType("change_type").notNull(),

  // Inventory changes
  previousInventory: customNumeric("previous_inventory").notNull(),
  inventoryChange: customNumeric("inventory_change").notNull(),
  currentInventory: customNumeric("current_inventory").notNull(),

  // Cost price changes
  previousCostPrice: customNumeric("previous_cost_price"),
  costPriceChange: customNumeric("cost_price_change"),
  currentCostPrice: customNumeric("current_cost_price"),

  referenceId: uuid("reference_id"), // ID of related document (order, receipt import, return, check)

  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
});

export type InsertProductInventoryLog =
  typeof productInventoryLogTable.$inferInsert;
export type SelectProductInventoryLog =
  typeof productInventoryLogTable.$inferSelect;