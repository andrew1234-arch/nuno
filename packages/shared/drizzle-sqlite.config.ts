import { defineConfig } from "drizzle-kit";

// Generates the SQLite migrations (applied by the local driver on open).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/sqlite/schema.ts",
  out: "./migrations",
});
