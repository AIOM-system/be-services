import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isDev } from "../utils/index.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");

if (!DATABASE_URL) {
  console.log("DATABASE_URL is not defined");
  Deno.exit(1);
}

const client = postgres(DATABASE_URL, {
  prepare: false,
  connect_timeout: 5000,
  max: 10,
});

/**
 * Ref: https://orm.drizzle.team/docs/goodies
 */
export const database = drizzle({
  client,
  casing: "snake_case",
  logger: isDev()
});
