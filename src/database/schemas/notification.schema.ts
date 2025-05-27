import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DbTables } from "../../common/config/index.ts";
import { userTable } from "./user.schema.ts";
import { NotificationStatus } from "../enums/notification.enum.ts";

export const notificationStatus = pgEnum(
  "notification_status",
  Object.values(NotificationStatus) as [string, ...string[]],
);

export type NotificationMeta = {
  referenceId?: string;
  referenceType?: string;
};

export const notificationTable = pgTable(DbTables.Notifications, {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: notificationStatus("status").default(NotificationStatus.UNREAD),
  meta: jsonb("meta").$type<NotificationMeta | null>().default(null),
  readAt: timestamp("read_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
});

export type InsertNotification = typeof notificationTable.$inferInsert;
export type SelectNotification = typeof notificationTable.$inferSelect;
