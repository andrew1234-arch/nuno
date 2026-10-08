import { defineConfig } from "drizzle-kit";

// Generates SQL migrations for local SQLite and Cloudflare D1 (wrangler applies the same files).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/sqlite/schema.ts",
  out: "./migrations",
});
