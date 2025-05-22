import { SQL, sql } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { DbTables } from "../../common/config/index.ts";
import { customNumeric } from "../custom/data-types.ts";
import { ProductStatus } from "../../modules/product/enums/product.enum.ts";

export const productStatus = pgEnum(
  "product_status",
  Object.values(ProductStatus) as [string, ...string[]],
);

export const productTable = pgTable(DbTables.Products, {
  id: uuid("id").primaryKey().defaultRandom(),
  productCode: integer("product_code").generatedByDefaultAsIdentity().unique(),
  productName: text("product_name").notNull(),
  sellingPrice: customNumeric("selling_price").default(0),
  costPrice: customNumeric("cost_price").default(0),
  discount: customNumeric("discount").default(0),
  inventory: customNumeric("inventory").default(0),
  unit: text("unit"),
  category: text("category"),
  description: text("description"),
  note: text("note"),
  imageUrls: text("image_urls")
    .array()
    .default(sql`ARRAY[]::text[]`),
  warehouse: text("warehouse"),
  status: productStatus("status").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }),
});

// Add a function to format product code
export function formatProductCode(productCode: number): string {
  return `NK${String(productCode).padStart(5, "0")}`;
}

export type InsertProduct = typeof productTable.$inferInsert;
export type SelectProduct = typeof productTable.$inferSelect;

interface ModifiedFields {
  inventory: SQL | number;
}

type UpdateProductType = Partial<
  Omit<SelectProduct, "id" | "createdAt">
>;

export type UpdateProduct =
  & Omit<UpdateProductType, keyof ModifiedFields>
  & ModifiedFields;
