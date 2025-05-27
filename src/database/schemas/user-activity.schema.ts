import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DbTables } from "../../common/config/index.ts";
import { userTable } from "./user.schema.ts";

export const userActivityTable = pgTable(DbTables.UserActivities, {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id),
  type: text("type").notNull(),
  description: text("description"),
  referenceId: uuid("reference_id"), // ID of related entity (product, receipt, etc)
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
});

export type InsertUserActivity = typeof userActivityTable.$inferInsert;
export type SelectUserActivity = typeof userActivityTable.$inferSelect;