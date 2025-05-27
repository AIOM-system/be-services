import { pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { DbTables } from "../../common/config/index.ts";
import { customNumeric } from "../custom/data-types.ts";
import { timestampsWithDeletedAt } from "../custom/helpers.ts";
import { SupplierStatus } from "../enums/supplier.enum.ts";

export const supplierStatus = pgEnum(
  "supplier_status",
  Object.values(SupplierStatus) as [string, ...string[]]
);

export const supplierTable = pgTable(
  DbTables.Suppliers,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").unique().notNull(),
    name: text("name").unique().notNull(),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    taxCode: text("tax_code"),
    address: text("address"),
    note: text("note"),
    totalDebt: customNumeric("total_debt").default(0),
    totalPurchased: customNumeric("total_purchased").default(0),
    status: supplierStatus("status").default(SupplierStatus.COLLABORATING),
    ...timestampsWithDeletedAt,
  },
  (table) => ({
    uniqueCodeName: uniqueIndex("supplier_code_name_unique_idx").on(
      table.code,
      table.name
    ),
  })
);

export type InsertSupplier = typeof supplierTable.$inferInsert;
export type SelectSupplier = typeof supplierTable.$inferSelect;

export type UpdateSupplier = Partial<
  Omit<SelectSupplier, "id" | "code" | "createdAt">
>;
