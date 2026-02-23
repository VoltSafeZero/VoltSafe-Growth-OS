import { db } from "./db";
import {
  metrics,
  sales,
  chartData,
  marinas,
  type Metric,
  type Sale,
  type ChartData,
  type Marina,
} from "@shared/schema";
import { ilike, eq, or, sql, asc } from "drizzle-orm";

export interface IStorage {
  getMetrics(): Promise<Metric[]>;
  getSales(): Promise<Sale[]>;
  getChartData(): Promise<ChartData[]>;
  getMarinas(options: { search?: string; state?: string; page?: number; limit?: number }): Promise<{ data: Marina[]; total: number; page: number; totalPages: number }>;
  getMarinaStates(): Promise<string[]>;
}

export class DatabaseStorage implements IStorage {
  async getMetrics(): Promise<Metric[]> {
    return await db.select().from(metrics);
  }

  async getSales(): Promise<Sale[]> {
    return await db.select().from(sales);
  }

  async getChartData(): Promise<ChartData[]> {
    return await db.select().from(chartData);
  }

  async getMarinas(options: { search?: string; state?: string; page?: number; limit?: number }) {
    const page = options.page || 1;
    const limit = options.limit || 25;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (options.search) {
      conditions.push(
        or(
          ilike(marinas.name, `%${options.search}%`),
          ilike(marinas.city, `%${options.search}%`),
          ilike(marinas.state, `%${options.search}%`)
        )
      );
    }
    if (options.state) {
      conditions.push(eq(marinas.state, options.state));
    }

    const where = conditions.length > 0
      ? conditions.length === 1
        ? conditions[0]
        : sql`${conditions[0]} AND ${conditions[1]}`
      : undefined;

    const [data, countResult] = await Promise.all([
      db.select().from(marinas).where(where).orderBy(asc(marinas.state), asc(marinas.name)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(marinas).where(where),
    ]);

    const total = Number(countResult[0].count);
    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getMarinaStates(): Promise<string[]> {
    const result = await db
      .selectDistinct({ state: marinas.state })
      .from(marinas)
      .orderBy(asc(marinas.state));
    return result.map((r) => r.state);
  }
}

export const storage = new DatabaseStorage();