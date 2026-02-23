import { pgTable, text, serial, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  value: text("value").notNull(),
  change: text("change").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
});

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  amount: text("amount").notNull(),
  avatarUrl: text("avatar_url").notNull(),
});

export const chartData = pgTable("chart_data", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  revenue: integer("revenue").notNull(),
});

export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true });
export const insertSaleSchema = createInsertSchema(sales).omit({ id: true });
export const insertChartDataSchema = createInsertSchema(chartData).omit({ id: true });

export type Metric = typeof metrics.$inferSelect;
export type InsertMetric = z.infer<typeof insertMetricSchema>;

export type Sale = typeof sales.$inferSelect;
export type InsertSale = z.infer<typeof insertSaleSchema>;

export type ChartData = typeof chartData.$inferSelect;
export type InsertChartData = z.infer<typeof insertChartDataSchema>;

export const marinas = pgTable("marinas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  city: text("city").notNull(),
  slips: text("slips"),
  segment: text("segment"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  phone: text("phone"),
  streetAddress: text("street_address"),
  zipCode: text("zip_code"),
});

export const insertMarinaSchema = createInsertSchema(marinas).omit({ id: true });

export type Marina = typeof marinas.$inferSelect;
export type InsertMarina = z.infer<typeof insertMarinaSchema>;
