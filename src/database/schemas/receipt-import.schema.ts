import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { DbTables } from "../../common/config/index.ts";
import { ReceiptImportStatus } from "../enums/receipt.enum.ts";
import { customNumeric } from "../custom/data-types.ts";
import { timestampsWithouDeletedAt } from "../custom/helpers.ts";

import { supplierTable } from "./supplier.schema.ts";
import { userTable } from "./user.schema.ts";

export const receiptImportStatus = pgEnum(
  "receipt_import_status",
  Object.values(ReceiptImportStatus) as [string, ...string[]],
);

export interface ChangeLog {
  user: string;
  oldStatus: ReceiptImportStatus;
  newStatus: ReceiptImportStatus;
  timestamp: string;
}

export const receiptImportTable = pgTable(DbTables.ReceiptImports, {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptNumber: text("receipt_number").unique().notNull(),
  note: text("note"),
  quantity: integer("quantity").default(0),
  totalProduct: integer("total_product").default(0),
  totalAmount: customNumeric("total_amount").default(0),
  supplier: uuid("supplier").references(() => supplierTable.id),
  warehouse: text("warehouse"),
  paymentDate: timestamp("payment_date", { mode: "string" }),
  importDate: timestamp("import_date", { mode: "string" }),
  status: receiptImportStatus("status").default(ReceiptImportStatus.DRAFT),
  userCreated: uuid("user_created").notNull().references(() => userTable.id),
  changeLog: jsonb("change_logs").$type<ChangeLog[]>().default([]),
  ...timestampsWithouDeletedAt,
});

export type InsertReceiptImport = typeof receiptImportTable.$inferInsert;
export type SelectReceiptImport = typeof receiptImportTable.$inferSelect;

export type UpdateReceiptImport = Partial<
  Omit<SelectReceiptImport, "id" | "receiptNumber" | "createdAt">
>;
