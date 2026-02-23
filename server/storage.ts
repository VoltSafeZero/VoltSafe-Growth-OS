import { db } from "./db";
import {
  metrics,
  sales,
  chartData,
  type Metric,
  type Sale,
  type ChartData,
} from "@shared/schema";

export interface IStorage {
  getMetrics(): Promise<Metric[]>;
  getSales(): Promise<Sale[]>;
  getChartData(): Promise<ChartData[]>;
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
}

export const storage = new DatabaseStorage();