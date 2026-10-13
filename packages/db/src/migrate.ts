import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { closeDb, getDb } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

// DATABASE_MIGRATION_URL: optional user with DDL privileges, only for migrations (Kubernetes init container).
await migrate(getDb(process.env.DATABASE_MIGRATION_URL || undefined), { migrationsFolder: resolve(here, "../migrations") });
await closeDb();
console.log("migrations applied");
