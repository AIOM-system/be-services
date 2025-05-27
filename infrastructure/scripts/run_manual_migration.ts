#!/usr/bin/env -S deno run -A

import { readFileSync } from "node:fs";
import postgres from "postgres";

// Get database connection string from environment or use default
const DATABASE_URL =
  Deno.env.get("DATABASE_URL") || "postgresql://localhost:5432/aiom_db";

async function runManualMigration() {
  console.log("Running manual migration to fix supplier_status enum...");

  try {
    // Read the SQL file
    const sql = readFileSync(
      "./src/database/migrations/manual_fix_supplier_status.sql",
      "utf8"
    );

    // Connect to the database
    const client = postgres(DATABASE_URL);

    // Execute the SQL
    await client.unsafe(sql);

    console.log("Migration completed successfully!");

    // Close the connection
    await client.end();
  } catch (error) {
    console.error("Error running migration:", error);
    Deno.exit(1);
  }
}

await runManualMigration();
