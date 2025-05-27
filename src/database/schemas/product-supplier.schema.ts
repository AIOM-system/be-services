import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { DbTables } from "../../common/config/index.ts";
import { customNumeric } from "../custom/data-types.ts";

import { productTable } from "./product.schema.ts";
import { supplierTable } from "./supplier.schema.ts";

export const productSupplierTable = pgTable(DbTables.ProductSuppliers, {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => productTable.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => supplierTable.id, { onDelete: "cascade" }),
  costPrice: customNumeric("cost_price").default(0),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
}, (table) => ({
  uniqueProductSupplierIdx: uniqueIndex("product_supplier_unique_idx").on(
    table.productId,
    table.supplierId
  ),
}));

export type InsertProductSupplier = typeof productSupplierTable.$inferInsert;
export type SelectProductSupplier = typeof productSupplierTable.$inferSelect;
