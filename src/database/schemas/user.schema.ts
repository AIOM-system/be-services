import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { DbTables } from "../../common/config/index.ts";
import { UserRole, UserStatus } from "../enums/user.enum.ts";
import { timestampsWithDeletedAt } from "../custom/helpers.ts";

export const userStatus = pgEnum(
  "user_status",
  Object.values(UserStatus) as [string, ...string[]],
);

export const userRole = pgEnum(
  "user_role",
  Object.values(UserRole) as [string, ...string[]],
);

interface DeviceToken {
  token: string;
  deviceType: string;
}

export const userTable = pgTable(DbTables.Users, {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").unique(),
  username: text("username").unique(),
  password: text("password"),
  salt: text("salt"),
  tokenVersion: text("token_version"),
  fullname: text("fullname"),
  phone: text("phone"),
  storeCode: text("store_code"),
  role: userRole("role"),
  status: userStatus("status").default(UserStatus.ACTIVE),
  deviceTokens: jsonb("device_tokens").$type<DeviceToken[]>().default([]),
  metadata: jsonb("metadata"),
  ...timestampsWithDeletedAt,
});

export type InsertUser = typeof userTable.$inferInsert;
export type SelectUser = typeof userTable.$inferSelect;
