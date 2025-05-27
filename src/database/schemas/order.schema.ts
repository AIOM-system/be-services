import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
} from "drizzle-orm/pg-core";

import { DbTables } from "../../common/config/index.ts";
import { customNumeric } from "../custom/data-types.ts";
import type { OrderItem, VatInfo } from "../../common/types/order.d.ts";
import { timestampsWithouDeletedAt } from "../custom/helpers.ts";
import { OrderStatus, PaymentMethod } from "../enums/order.enum.ts";

export const orderStatus = pgEnum(
  "order_status",
  Object.values(OrderStatus) as [string, ...string[]]
);

export const paymentMethod = pgEnum(
  "payment_method",
  Object.values(PaymentMethod) as [string, ...string[]]
);

export const orderTable = pgTable(DbTables.Orders, {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").unique().notNull(),
  customerType: text("customer_type").notNull(),
  paymentMethod: paymentMethod("payment_method").notNull(),
  note: text("note"),
  discountAmount: customNumeric("discount_amount").notNull(),
  totalAmount: customNumeric("total_amount").notNull(),
  status: orderStatus("status").notNull().default(OrderStatus.DRAFT),
  vatInfo: jsonb("vat_info").$type<VatInfo | null>().default(null),
  items: jsonb("items").$type<OrderItem[]>().notNull().default([]),
  ...timestampsWithouDeletedAt,
});

export type InsertOrder = typeof orderTable.$inferInsert;
export type SelectOrder = typeof orderTable.$inferSelect;

export type UpdateOrder = Partial<
  Omit<SelectOrder, "id" | "code" | "createdAt">
>;
