import { z } from "zod";

export const api = {
  metrics: {
    list: { method: "GET" as const, path: "/api/metrics" as const },
  },
  sales: {
    list: { method: "GET" as const, path: "/api/sales" as const },
  },
  chartData: {
    list: { method: "GET" as const, path: "/api/chart-data" as const },
  },
  marinas: {
    list: { method: "GET" as const, path: "/api/marinas" as const },
    states: { method: "GET" as const, path: "/api/marinas/states" as const },
  },
  dashboard: {
    summary: { method: "GET" as const, path: "/api/dashboard/summary" as const },
  },
  leads: {
    list: { method: "GET" as const, path: "/api/leads" as const },
    get: { method: "GET" as const, path: "/api/leads/:id" as const },
    create: { method: "POST" as const, path: "/api/leads" as const },
    update: { method: "PUT" as const, path: "/api/leads/:id" as const },
    delete: { method: "DELETE" as const, path: "/api/leads/:id" as const },
    convert: { method: "POST" as const, path: "/api/leads/:id/convert" as const },
  },
  accounts: {
    list: { method: "GET" as const, path: "/api/accounts" as const },
    get: { method: "GET" as const, path: "/api/accounts/:id" as const },
    create: { method: "POST" as const, path: "/api/accounts" as const },
    update: { method: "PUT" as const, path: "/api/accounts/:id" as const },
  },
  contacts: {
    list: { method: "GET" as const, path: "/api/contacts" as const },
    get: { method: "GET" as const, path: "/api/contacts/:id" as const },
    create: { method: "POST" as const, path: "/api/contacts" as const },
    update: { method: "PUT" as const, path: "/api/contacts/:id" as const },
    delete: { method: "DELETE" as const, path: "/api/contacts/:id" as const },
  },
  opportunities: {
    list: { method: "GET" as const, path: "/api/opportunities" as const },
    get: { method: "GET" as const, path: "/api/opportunities/:id" as const },
    create: { method: "POST" as const, path: "/api/opportunities" as const },
    update: { method: "PUT" as const, path: "/api/opportunities/:id" as const },
  },
  tickets: {
    list: { method: "GET" as const, path: "/api/tickets" as const },
    get: { method: "GET" as const, path: "/api/tickets/:id" as const },
    create: { method: "POST" as const, path: "/api/tickets" as const },
    update: { method: "PUT" as const, path: "/api/tickets/:id" as const },
  },
  quotes: {
    list: { method: "GET" as const, path: "/api/quotes" as const },
    get: { method: "GET" as const, path: "/api/quotes/:id" as const },
    create: { method: "POST" as const, path: "/api/quotes" as const },
    update: { method: "PUT" as const, path: "/api/quotes/:id" as const },
    nextNumber: { method: "GET" as const, path: "/api/quotes/next-number" as const },
  },
  activities: {
    list: { method: "GET" as const, path: "/api/activities" as const },
    create: { method: "POST" as const, path: "/api/activities" as const },
  },
  tasks: {
    list: { method: "GET" as const, path: "/api/tasks" as const },
    create: { method: "POST" as const, path: "/api/tasks" as const },
    update: { method: "PUT" as const, path: "/api/tasks/:id" as const },
  },
  commLists: {
    list: { method: "GET" as const, path: "/api/comm-lists" as const },
    create: { method: "POST" as const, path: "/api/comm-lists" as const },
    update: { method: "PUT" as const, path: "/api/comm-lists/:id" as const },
  },
  campaigns: {
    list: { method: "GET" as const, path: "/api/campaigns" as const },
    get: { method: "GET" as const, path: "/api/campaigns/:id" as const },
    create: { method: "POST" as const, path: "/api/campaigns" as const },
    update: { method: "PUT" as const, path: "/api/campaigns/:id" as const },
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
