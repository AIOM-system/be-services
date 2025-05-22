import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { DbTables } from "../../common/config/index.ts";
import { customNumeric } from "../custom/data-types.ts";

export const receiptItemTable = pgTable(DbTables.ReceiptItems, {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull(),
  productId: uuid("product_id").notNull(),
  productCode: integer("product_code").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").default(1),
  inventory: customNumeric("inventory").default(0),
  actualInventory: customNumeric("actual_inventory").default(0),
  discount: integer("discount").default(0),
  costPrice: customNumeric("cost_price").default(0),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }),
}, (table) => ({
  uniqueReceiptProductIdx: uniqueIndex("receipt_item_unique_idx").on(
    table.receiptId,
    table.productCode,
  ),
}));

export type InsertReceiptItem = typeof receiptItemTable.$inferInsert;
export type SelectReceiptItem = typeof receiptItemTable.$inferSelect;

interface ModifiedFields {
  inventory: SQL;
  actualInventory: SQL;
}

export type UpdateReceiptItemType = Partial<
  Omit<
    SelectReceiptItem,
    | "id"
    | "receiptId"
    | "productId"
    | "productCode"
    | "productName"
    | "createdAt"
  >
>;

export type UpdateReceiptItem =
  & Omit<
    UpdateReceiptItemType,
    keyof ModifiedFields
  >
  & ModifiedFields;
