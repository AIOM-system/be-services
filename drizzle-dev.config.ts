import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/database/schemas/*.schema.ts",
  out: "./src/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: "postgresql://localhost:5432/aiom_db",
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  strict: true,
  verbose: true,
});
