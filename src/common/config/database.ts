import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const DATABASE_URL = Deno.env.get("DATABASE_URL")!;
const client = postgres(DATABASE_URL, {
  prepare: false,
  connect_timeout: 5000,
  max: 10,
});
export const database = drizzle(client);
