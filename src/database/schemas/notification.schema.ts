import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DbTables } from "../../common/config/index.ts";
import { userTable } from "./user.schema.ts";
import { NotificationStatus } from "../enums/notification.enum.ts";

export const notificationTable = pgTable(DbTables.Notifications, {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status", {
    enum: [NotificationStatus.UNREAD, NotificationStatus.READ],
  }).default(NotificationStatus.UNREAD),
  data: jsonb("data"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  readAt: timestamp("read_at", { mode: "string" }),
});

export type InsertNotification = typeof notificationTable.$inferInsert;
export type SelectNotification = typeof notificationTable.$inferSelect;
