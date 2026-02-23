import { z } from "zod";
import { metrics, sales, chartData, insertMetricSchema, insertSaleSchema, insertChartDataSchema } from "./schema";

export const errorSchemas = {
  notFound: z.object({ message: z.string() }),
};

export const api = {
  metrics: {
    list: {
      method: "GET" as const,
      path: "/api/metrics" as const,
      responses: {
        200: z.array(z.custom<typeof metrics.$inferSelect>()),
      },
    },
  },
  sales: {
    list: {
      method: "GET" as const,
      path: "/api/sales" as const,
      responses: {
        200: z.array(z.custom<typeof sales.$inferSelect>()),
      },
    },
  },
  chartData: {
    list: {
      method: "GET" as const,
      path: "/api/chart-data" as const,
      responses: {
        200: z.array(z.custom<typeof chartData.$inferSelect>()),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
