import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { db } from "./db";
import { metrics, sales, chartData } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get(api.metrics.list.path, async (req, res) => {
    const result = await storage.getMetrics();
    res.json(result);
  });

  app.get(api.sales.list.path, async (req, res) => {
    const result = await storage.getSales();
    res.json(result);
  });

  app.get(api.chartData.list.path, async (req, res) => {
    const result = await storage.getChartData();
    res.json(result);
  });

  // Seed the database
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const existingMetrics = await storage.getMetrics();
  if (existingMetrics.length === 0) {
    await db.insert(metrics).values([
      {
        title: "Total Revenue",
        value: "$45,231.89",
        change: "+20.1% from last month",
        description: "",
        icon: "dollar-sign"
      },
      {
        title: "Subscriptions",
        value: "+2350",
        change: "+180.1% from last month",
        description: "",
        icon: "users"
      },
      {
        title: "Sales",
        value: "+12,234",
        change: "+19% from last month",
        description: "",
        icon: "credit-card"
      },
      {
        title: "Active Now",
        value: "+573",
        change: "+201 since last hour",
        description: "",
        icon: "activity"
      }
    ]);
  }

  const existingSales = await storage.getSales();
  if (existingSales.length === 0) {
    await db.insert(sales).values([
      { name: "Olivia Martin", email: "olivia.martin@email.com", amount: "+$1,999.00", avatarUrl: "https://i.pravatar.cc/150?u=olivia" },
      { name: "Jackson Lee", email: "jackson.lee@email.com", amount: "+$39.00", avatarUrl: "https://i.pravatar.cc/150?u=jackson" },
      { name: "Isabella Nguyen", email: "isabella.nguyen@email.com", amount: "+$299.00", avatarUrl: "https://i.pravatar.cc/150?u=isabella" },
      { name: "William Kim", email: "will@email.com", amount: "+$99.00", avatarUrl: "https://i.pravatar.cc/150?u=william" },
      { name: "Sofia Davis", email: "sofia.davis@email.com", amount: "+$39.00", avatarUrl: "https://i.pravatar.cc/150?u=sofia" },
    ]);
  }

  const existingChartData = await storage.getChartData();
  if (existingChartData.length === 0) {
    await db.insert(chartData).values([
      { month: "Jan", revenue: 4000 },
      { month: "Feb", revenue: 3000 },
      { month: "Mar", revenue: 2000 },
      { month: "Apr", revenue: 2780 },
      { month: "May", revenue: 1890 },
      { month: "Jun", revenue: 2390 },
      { month: "Jul", revenue: 3490 },
      { month: "Aug", revenue: 4000 },
      { month: "Sep", revenue: 3000 },
      { month: "Oct", revenue: 2000 },
      { month: "Nov", revenue: 2780 },
      { month: "Dec", revenue: 1890 },
    ]);
  }
}