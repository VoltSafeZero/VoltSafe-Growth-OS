import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 20 connections supports ~100 concurrent active users with mixed CRM/AI/sync load.
  // 4 background scheduler tasks consume up to 4 connections; the remaining 16 serve
  // user-facing requests. Raise to 30 before exceeding 200 concurrent users.
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error:", err.message);
});

export const db = drizzle(pool, { schema });