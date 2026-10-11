// Node-only entry: env/.env config and the local SQLite driver.
export * from "./config.js";
export { openLocal, migrate, MIGRATIONS_DIR } from "./sqlite/local.js";
