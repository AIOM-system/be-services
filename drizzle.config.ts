import { defineConfig } from "drizzle-kit";

const DATABASE_URL = Deno.env.get("DATABASE_URL");

if (!DATABASE_URL) {
  console.log("DATABASE_URL is not defined");
  Deno.exit(1);
}

export default defineConfig({
  schema: "./src/database/schemas/*.schema.ts",
  out: "./src/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  strict: true,
  verbose: true,
});
