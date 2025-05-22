import { sql } from "drizzle-orm";
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { DbTables } from "../../common/config/index.ts";
import { UserRole, UserStatus } from "../enums/user.enum.ts";

export const userStatus = pgEnum(
  "user_status",
  Object.values(UserStatus) as [string, ...string[]],
);

export const userRole = pgEnum(
  "user_role",
  Object.values(UserRole) as [string, ...string[]],
);

export const userTable = pgTable(DbTables.Users, {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").unique(),
  username: text("username").unique(),
  password: text("password"),
  salt: text("salt"),
  fullname: text("fullname"),
  phone: text("phone"),
  storeCode: text("store_code"),
  role: userRole("role"),
  status: userStatus("status").notNull().default(UserStatus.ACTIVE),
  tokenVersion: text("token_version"),
  deviceTokens: text("device_tokens").array().default(sql`ARRAY[]::text[]`),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }),
  deletedAt: timestamp("deleted_at", { mode: "string" }),
});

export type InsertUser = typeof userTable.$inferInsert;
export type SelectUser = typeof userTable.$inferSelect;
