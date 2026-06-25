import http from "k6/http";
import { sleep, check, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const crmLatency = new Trend("crm_latency");
const dashboardLatency = new Trend("dashboard_latency");
const adminLatency = new Trend("admin_latency");

export const options = {
  stages: [
    { duration: "2m", target: 50 },
    { duration: "2m", target: 100 },
    { duration: "6m", target: 100 },
    { duration: "2m", target: 0 },
  ],
  thresholds: {
    errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
    crm_latency: ["p(95)<800"],
    dashboard_latency: ["p(95)<1500"],
    http_req_duration: ["p(95)<1500"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

const HEADERS = {
  Cookie: SESSION_COOKIE,
  "Content-Type": "application/json",
};

const SCENARIOS = [
  // CRM reads (50% of traffic — typical browsing)
  { weight: 0.50, group: "CRM reads", urls: [
    "/api/leads?page=1&limit=20",
    "/api/accounts?page=1&limit=20",
    "/api/contacts?page=1&limit=20",
    "/api/opportunities?page=1&limit=20",
    "/api/tickets?page=1&limit=20",
    "/api/quotes?page=1&limit=20",
  ]},
  // Dashboard & analytics (25%)
  { weight: 0.25, group: "Dashboard", urls: [
    "/api/metrics",
    "/api/activities?limit=20",
    "/api/tasks?page=1&limit=20",
  ]},
  // Mail inbox (15%)
  { weight: 0.15, group: "Mail", urls: [
    "/api/gmail/messages?limit=20",
    "/api/email-accounts",
  ]},
  // Admin & monitoring (10%)
  { weight: 0.10, group: "Admin", urls: [
    "/api/users",
    "/health",
  ]},
];

function pickScenario() {
  const r = Math.random();
  let cumulative = 0;
  for (const s of SCENARIOS) {
    cumulative += s.weight;
    if (r <= cumulative) return s;
  }
  return SCENARIOS[0];
}

export default function () {
  const scenario = pickScenario();
  const url = scenario.urls[Math.floor(Math.random() * scenario.urls.length)];
  const res = http.get(`${BASE_URL}${url}`, { headers: HEADERS });

  if (scenario.group === "CRM reads") crmLatency.add(res.timings.duration);
  else if (scenario.group === "Dashboard") dashboardLatency.add(res.timings.duration);
  else if (scenario.group === "Admin") adminLatency.add(res.timings.duration);

  const ok = check(res, {
    "status ok": (r) => r.status === 200 || r.status === 401 || r.status === 429,
    "not a 500": (r) => r.status < 500,
  });
  errorRate.add(!ok);

  sleep(1 + Math.random() * 3);
}
