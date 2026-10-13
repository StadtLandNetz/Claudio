import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";

export type Db = MySql2Database<typeof schema>;

let cached: { db: Db; pool: mysql.Pool } | undefined;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/** One pool per process. */
export function getDb(url: string = databaseUrl()): Db {
  if (!cached) {
    const pool = mysql.createPool({ uri: url, connectionLimit: 10, timezone: "Z" });
    cached = { pool, db: drizzle(pool, { schema, mode: "default" }) };
  }
  return cached.db;
}

export async function closeDb(): Promise<void> {
  await cached?.pool.end();
  cached = undefined;
}
